#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
wow 五大视图流转 pty 实测（纯 Python 标准库，不依赖 node-pty）。

《尚书省第 3.7.0 视图重构与功能补丁执行令》阶段 6 的可执行回归：
用真实 TTY 驱动 `node src/cli.js L`，走**真实 `server start` 主路径**
（fake-java + dummy 方案），实测视图流转、单例 readline、防僵尸红线。

场景
  A  shell -> :wow -> :m -> :wow -> exit        无 MC，菜单往返 + 双写哨兵
  B  shell -> :wow -> :mc -> :wow -> :mc         fake MC，核心流转
     -> Ctrl+C 安全退场 -> :wow -> :mc           且 MC 全程不能被误杀
  C  强关终端（SIGTERM）                        MC 优雅退出、无残留/僵尸
  D  Web 端触发启服（心跳模拟）                  :wow 自动切 :mc

为什么用 pty.fork() 而不是管道：
  执行令的「sseerrvveerr 双写」「TUI 键盘」「单次 Ctrl+C」全都是 TTY 专属
  行为；`spawnSync({ stdio: 'pipe' })` 下 readline 不会进 raw/terminal 模式，
  测出来的是另一条代码路径，等于没测。

零污染设计
  - 每个场景独立 `tempfile.mkdtemp()`，内含 wow.yaml / scheme/fake.jar /
    fake-java；`WOW_CONFIG_FILE` 指过去，`server.dir` 用绝对路径指过去。
  - 只有 `core/.console.alive`（Web 指令中继心跳）是硬编码路径，D 场景
    用 `AliveGuard` 备份 -> 写心跳 -> 原样恢复/删除。
  - `finally` 里 killpg / waitpid / rmtree / 补杀漏网 fake-java，杜绝僵尸。

超时天花板（关键）
  `core/test/run.js` 用 spawnSync 顺序执行且**自身没有 timeout**，所以
  pty 测试文件必须自带超时：`.test.js` 里的 spawnSync 有 120s timeout +
  SIGKILL，本脚本再叠一层 signal.alarm(100)。任何一步卡住都必然退出。

输出协议（供 pty_views.test.js 解析）
  [SCENARIO A] PASS 说明...
  [SCENARIO B] FAIL 原因...
  [PTY_RESULT] ok=3 fail=1
退出码：全过 0，否则 1。
"""

import os
import re
import sys
import pty
import fcntl
import termios
import struct
import select
import signal
import shutil
import tempfile
import threading
import time

CORE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CLI_REL = 'src/cli.js'
ALIVE_FILE = os.path.join(CORE, '.console.alive')
QUEUE_FILE = os.path.join(CORE, '.console.queue')

STRICT = os.environ.get('WOW_PTY_STRICT') == '1'
DUMP = os.environ.get('WOW_PTY_DUMP') == '1'     # 调试：把各会话剥离后的输出落到 /tmp
_SESSIONS = []

ANSI = re.compile(r'\x1b\[[0-9;:?]*[ -/]*[@-~]|\x1b[=>()][0-9A-Za-z]*|\x1b[78]|\x1bc')


def strip_ansi(s):
    return ANSI.sub('', s)


class Ceiling(Exception):
    """signal.alarm 天花板到点。"""


def _on_alarm(_sig, _frame):
    raise Ceiling('pty 全局天花板超时')


signal.signal(signal.SIGALRM, _on_alarm)


# --------------------------------------------------------------------------
# 临时环境
# --------------------------------------------------------------------------

FAKE_JAVA = r'''#!/usr/bin/env node
// pty 回归专用假 Java：忽略全部 JVM 参数，模拟一个 Minecraft 服务端进程。
// 收到 stdin 的 stop 或 SIGTERM/SIGHUP/SIGINT 都会「优雅退出」并打印标记，
// 让 pty 侧能断言强关终端时没有孤儿 / 僵尸残留。
process.stdout.write('[FAKE-MC] Starting minecraft server\n');
process.stdout.write('[FAKE-MC] Done! For help, type "help"\n');
let n = 0;
const t = setInterval(() => { process.stdout.write(`[FAKE-MC] tick ${++n}\n`); }, 700);
let gone = false;
function bye(reason) {
  if (gone) return;
  gone = true;
  clearInterval(t);
  process.stdout.write(`[FAKE-MC] Stopping (${reason})\n`);
  setTimeout(() => process.exit(0), 40);
}
process.stdin.on('data', d => { if (d.toString().includes('stop')) bye('stdin stop'); });
process.on('SIGTERM', () => bye('SIGTERM'));
process.on('SIGHUP', () => bye('SIGHUP'));
process.on('SIGINT', () => bye('SIGINT'));
'''


def make_env(root, scenario):
    """在 root/<scenario>/ 下造一套独立配置 + dummy 方案，返回 (dir, env)。"""
    d = os.path.join(root, scenario)
    scheme = os.path.join(d, 'scheme')
    os.makedirs(os.path.join(scheme, 'logs'), exist_ok=True)

    java = os.path.join(d, 'fake-java')
    with open(java, 'w', encoding='utf-8') as f:
        f.write(FAKE_JAVA)
    os.chmod(java, 0o755)

    # _getServerJar() 只要求「存在且以 .jar 结尾」，空文件即可。
    with open(os.path.join(scheme, 'fake.jar'), 'wb') as f:
        f.write(b'')

    cfg = (
        "server:\n"
        "  dir: %s\n"
        "  jar: fake.jar\n"
        "  java: %s\n"
        "  jvm:\n"
        "    template: b\n"
        "    override_args: []\n"
        "log:\n"
        "  disabled: true\n"
        "web:\n"
        "  require_login: false\n"
        "  run_startup: false\n"
        "plugins:\n"
        "  enabled_loader: false\n"
        "lan:\n"
        "  auto_room: false\n"
    ) % (scheme, java)
    cfg_path = os.path.join(d, 'wow.yaml')
    with open(cfg_path, 'w', encoding='utf-8') as f:
        f.write(cfg)

    env = dict(os.environ)
    env['WOW_CONFIG_FILE'] = cfg_path
    env['WOW_STDIN_ASSERT'] = '1'          # 让 stdin_session 打运行时探针
    env['TERM'] = 'xterm-256color'
    env['COLUMNS'] = '100'
    env['LINES'] = '30'
    return d, env


# --------------------------------------------------------------------------
# pty 会话
# --------------------------------------------------------------------------

class Sess:
    def __init__(self, env, argv=None):
        argv = argv or [CLI_REL, 'L']
        self.pid, self.fd = pty.fork()
        if self.pid == 0:                       # 子进程
            os.chdir(CORE)
            os.execvpe('node', ['node'] + argv, env)
        # pty.fork() 默认 winsize 是 0x0，Node 的 process.stdout.columns 会是
        # undefined，TUI 排版会直接崩。显式设成 30 行 x 100 列。
        try:
            fcntl.ioctl(self.fd, termios.TIOCSWINSZ,
                       struct.pack('HHHH', 30, 100, 0, 0))
        except OSError:
            pass
        self.buf = ''
        self.pos = 0
        self.dead = False
        _SESSIONS.append(self)

    def pump(self, wait=0.15):
        """在 wait 秒内尽量把 fd 里的输出读干净。"""
        end = time.time() + wait
        while time.time() < end:
            try:
                r, _, _ = select.select([self.fd], [], [],
                                        min(end - time.time(), 0.05))
            except (OSError, ValueError):
                return
            if not r:
                continue
            try:
                data = os.read(self.fd, 65536)
            except OSError:                    # EIO：子进程已退出
                return
            if not data:
                return
            self.buf += data.decode('utf-8', 'replace')

    def expect(self, pattern, timeout=12):
        """从上次匹配结束处顺序等待 pattern；超时抛 AssertionError。"""
        dl = time.time() + timeout
        while True:
            m = re.search(pattern, self.buf[self.pos:])
            if m:
                self.pos += m.end()
                return m
            if time.time() > dl:
                raise AssertionError(
                    '等待 /%s/ 超时 %ss；最近输出: %r'
                    % (pattern, timeout, strip_ansi(self.buf[-400:])))
            self.pump(0.1)

    def send(self, text):
        try:
            os.write(self.fd, text.encode('utf-8'))
        except OSError:
            pass

    def signal(self, sig):
        try:
            os.kill(self.pid, sig)
        except OSError:
            pass

    def close(self, graceful=True, wait=1.4):
        """先 SIGTERM 触发 shutdown.js 优雅停服，再 SIGKILL 兜底并 waitpid。"""
        if self.dead:
            return
        self.dead = True
        # 不碰 signal.alarm：全局天花板由 main() 统一持有与清除，
        # 在这里清掉会让后续场景失去超时保护。
        if graceful:
            self.signal(signal.SIGTERM)
            self.pump(wait)
        self.signal(signal.SIGKILL)
        try:
            os.waitpid(self.pid, 0)
        except OSError:
            pass
        try:
            os.close(self.fd)
        except OSError:
            pass


# --------------------------------------------------------------------------
# 断言工具
# --------------------------------------------------------------------------

DOUBLE_SENTINELS = (
    'bbaaddaappppllee',
    'sseerrvveerr',
    'bbaaddaappppllee',
    '未知指令: bbaadd',
)


def assert_no_double(clean, label):
    for bad in DOUBLE_SENTINELS:
        if bad in clean:
            raise AssertionError('%s：检测到输入双写 %r' % (label, bad))
    # 「无连续重复字符」的兜底：形如 sseerrvveerr 的成对字母串
    if re.search(r'\b(?:([a-z])\1){4,}\b', clean):
        raise AssertionError('%s：输出里出现连续成对字母（疑似双写）' % label)


def assert_single_readline(clean, label, min_lines=2):
    """把「只有一个 readline」从输出现象上升到运行时数据。"""
    lines = [ln for ln in clean.splitlines() if '[WOW_PROBE]' in ln]
    if len(lines) < min_lines:
        raise AssertionError('%s：探针行数不足（%d < %d），WOW_STDIN_ASSERT 未生效？'
                             % (label, len(lines), min_lines))
    peaks = [int(m.group(1)) for ln in lines
             for m in [re.search(r'peak=(\d+)', ln)] if m]
    viols = [int(m.group(1)) for ln in lines
             for m in [re.search(r'violations=(\d+)', ln)] if m]
    if not peaks or not viols:
        raise AssertionError('%s：探针格式异常，缺 peak=/violations=' % label)
    if max(peaks) > 1:
        raise AssertionError('%s：readline 活跃实例峰值 peak=%d（必须 <= 1）'
                             % (label, max(peaks)))
    if max(viols) != 0:
        raise AssertionError('%s：有 %d 处绕过单例直接创建 stdin readline'
                             % (label, max(viols)))
    return len(lines)


def assert_clean_exit(clean, label):
    for noise in ('⚠️ stdin 被', '强制接管', '不变式被破坏', '拒绝创建第二个 readline'):
        if noise in clean:
            raise AssertionError('%s：出现 readline 冲突告警 %r' % (label, noise))


class AliveGuard:
    """D 场景要写硬编码的 core/.console.alive，用完原样恢复/删除。"""

    def __init__(self):
        self.existed = os.path.exists(ALIVE_FILE)
        self.backup = None
        self.queue_existed = os.path.exists(QUEUE_FILE)
        self.queue_backup = None
        self.stop_evt = threading.Event()
        self.thread = None

    def __enter__(self):
        if self.existed:
            with open(ALIVE_FILE, 'r', encoding='utf-8', errors='replace') as f:
                self.backup = f.read()
        if self.queue_existed:
            with open(QUEUE_FILE, 'r', encoding='utf-8', errors='replace') as f:
                self.queue_backup = f.read()
        return self

    def start_heartbeat(self):
        def beat():
            while not self.stop_evt.is_set():
                try:
                    with open(ALIVE_FILE, 'w', encoding='utf-8') as f:
                        f.write(str(int(time.time() * 1000)))
                except OSError:
                    pass
                self.stop_evt.wait(0.4)

        self.thread = threading.Thread(target=beat, daemon=True)
        self.thread.start()

    def __exit__(self, *_exc):
        self.stop_evt.set()
        if self.thread:
            self.thread.join(timeout=1.0)
        if self.existed:
            with open(ALIVE_FILE, 'w', encoding='utf-8') as f:
                f.write(self.backup or '')
        elif os.path.exists(ALIVE_FILE):
            try:
                os.unlink(ALIVE_FILE)
            except OSError:
                pass
        if self.queue_existed:
            with open(QUEUE_FILE, 'w', encoding='utf-8') as f:
                f.write(self.queue_backup or '')
        elif os.path.exists(QUEUE_FILE):
            try:
                os.unlink(QUEUE_FILE)
            except OSError:
                pass


def kill_leftover_fake_java(root):
    """按各场景 server.pid 补杀漏网的 fake-java，杜绝孤儿。"""
    for name in os.listdir(root):
        pid_file = os.path.join(root, name, 'scheme', 'server.pid')
        if not os.path.isfile(pid_file):
            continue
        try:
            with open(pid_file, 'r') as f:
                pid = int(f.read().strip())
            cmd = '/proc/%d/cmdline' % pid
            if os.path.exists(cmd):
                with open(cmd, 'rb') as f:
                    args = f.read().decode('utf-8', 'replace')
                if 'fake-java' in args:
                    os.kill(pid, signal.SIGKILL)
        except (OSError, ValueError):
            pass


def is_zombie(pid):
    try:
        with open('/proc/%d/stat' % pid, 'r') as f:
            return f.read().split(') ', 1)[-1].split(' ', 1)[0] == 'Z'
    except OSError:
        return False


# --------------------------------------------------------------------------
# 场景
# --------------------------------------------------------------------------

def scenario_a(root, env):
    """shell -> :wow -> :m -> :wow -> exit（无 MC，菜单往返 + 双写哨兵）。"""
    s = Sess(env)
    try:
        s.expect('已进入交互模式|长命令模式已就绪', 12)
        s.send('badapple\n')
        s.expect('未知指令: badapple', 8)
        s.pump(0.3)

        s.send('m\n')
        # TUI 首帧的 StatusBar.collect() 会同步扫系统 Java（约 5s），给足窗口。
        s.pump(6.5)
        s.expect('输入编号后回车执行|请选择（数字执行', 10)

        s.send('L')                            # TUI 里 L 是「按下即切」
        s.expect('已进入交互模式|长命令模式已就绪', 12)

        s.send('badapple\n')
        s.expect('未知指令: badapple', 8)
        s.pump(0.3)
        s.send('exit\n')
        s.pump(0.8)

        clean = strip_ansi(s.buf)
        assert clean.count('已进入交互模式') >= 2, '未走完 :wow -> :m -> :wow 往返'
        assert '输入编号后回车执行' in clean or '请选择（数字执行' in clean, '未进入 :m 菜单'
        assert clean.count('未知指令: badapple') == 2, '两次 badapple 哨兵回显次数不对'
        assert_no_double(clean, 'A')
        assert_clean_exit(clean, 'A')
        n = assert_single_readline(clean, 'A', min_lines=4)
        assert '再见~' in clean, 'REPL 未正常退出'
        return 'PASS 菜单往返 + 双写哨兵干净；探针 %d 行 peak<=1 violations=0' % n
    finally:
        s.close()


def scenario_b(root, env):
    """shell -> :wow -> :mc -> :wow -> :mc -> Ctrl+C -> :wow -> :mc（核心）。"""
    s = Sess(env)
    try:
        s.expect('已进入交互模式', 12)
        s.send('server start\n')
        s.expect('开服控制台|服务器已启动，PID: \\d+', 20)
        s.pump(2.0)                             # 让 fake MC 打几行 tick

        s.send(':wow\n')                        # :mc -> :wow（安全退场，不停服）
        s.expect('🧩 :wow 长命令|长命令（服务端仍在运行', 12)
        s.send('server status\n')               # :wow 里跑一条只读 wow 子命令
        s.pump(1.2)

        s.send(':mc\n')                         # 回 :mc
        s.expect('🎮 Minecraft 实时日志|开服控制台', 12)
        s.pump(1.0)

        s.send('\x03')                          # 单次 Ctrl+C：安全退场，绝不停服
        s.pump(1.6)
        s.expect('已退出实时日志流', 8)

        s.send(':mc\n')                         # 再回到 :mc，验证 MC 还活着、输入正常
        s.pump(1.8)

        clean = strip_ansi(s.buf)
        assert '开服控制台' in clean, '未进入 :mc 开服控制台'
        assert '🧩 :wow 长命令' in clean, '未切到 :wow 长命令视图'
        assert '🎮 Minecraft 实时日志' in clean, '回 :mc 时没打出实体页横幅'
        assert '已退出实时日志流' in clean, '单次 Ctrl+C 未走安全退场'
        assert clean.count('[FAKE-MC] tick') >= 3, 'fake MC 没有持续输出'

        # 执行令红线：安全退场之后 MC 必须还在跑（继续打 tick），没被误杀。
        after_detach = clean[clean.index('已退出实时日志流'):]
        assert '[FAKE-MC] tick' in after_detach, 'Ctrl+C 后 MC 停了（被误杀）'
        assert_no_double(clean, 'B')
        assert_clean_exit(clean, 'B')
        n = assert_single_readline(clean, 'B', min_lines=6)
        return ('PASS 真实 server start + :mc/:wow 往返 + Ctrl+C 不停服；'
                '探针 %d 行 peak<=1 violations=0' % n)
    finally:
        s.close()


def scenario_c(root, env):
    """强关终端（SIGTERM）：MC 优雅退出，无残留 / 无僵尸。"""
    s = Sess(env)
    mc_pid = None
    try:
        s.expect('已进入交互模式', 12)
        s.send('server start\n')
        m = s.expect(r'服务器已启动，PID: (\d+)', 20)
        mc_pid = int(m.group(1))
        # _printConsoleIntro() 在「服务器已启动」之前就打过了，pos 已越过，
        # 不能再按 expect 顺序等它；改成在整体输出里断言。
        s.pump(1.2)
        clean_pre = strip_ansi(s.buf)
        assert '开服控制台' in clean_pre, '未进入 :mc 控制台'
        assert '[FAKE-MC] tick' in clean_pre, '强关前 MC 没跑起来'

        # 模拟用户直接关终端窗口 / kill -TERM <pid>
        s.signal(signal.SIGTERM)
        s.pump(2.6)
        clean = strip_ansi(s.buf)

        assert ('[FAKE-MC] Stopping' in clean
                or '正在关闭服务器' in clean
                or '服务器已停止' in clean), 'SIGTERM 后没有观察到优雅停服'
        # 无残留进程；即便短暂存在也不能是僵尸
        alive = True
        try:
            os.kill(mc_pid, 0)
        except OSError:
            alive = False
        if alive:
            assert not is_zombie(mc_pid), 'MC 变成僵尸进程'
            raise AssertionError('SIGTERM 后 MC 进程 %d 仍存活' % mc_pid)
        assert_clean_exit(clean, 'C')
        return 'PASS SIGTERM 优雅停服，MC PID %d 无残留、无僵尸' % mc_pid
    finally:
        s.close(graceful=True, wait=0.8)
        if mc_pid:
            try:
                os.kill(mc_pid, signal.SIGKILL)
            except OSError:
                pass


def scenario_d(root, env):
    """Web 端触发启服：:wow 自动切 :mc（:m 不切页由静态断言锁定）。"""
    s = Sess(env)
    guard = AliveGuard()
    try:
        guard.__enter__()
        s.expect('已进入交互模式', 12)
        # startRepl 有一个「进入时服务器就已在跑」的 2s 延时检测。若心跳
        # 立刻开始刷，那条分支会抢先 startFollow() 把 following 置 true，
        # detectTimer 的 !following 条件就不成立了 —— 测不到本次要验的
        # 「Web 触发启服 -> 自动切 :mc」分支。先等这个窗口过去。
        s.pump(3.0)
        # 模拟「Web 面板 / 别的进程启动了服务端」：中继心跳文件开始刷新。
        # cli.js 的 detectTimer（1.5s）看到 wasRelayAlive false->true 后，
        # 在 :wow 视图会 setView('MC') 并 startFollow()。
        guard.start_heartbeat()
        s.expect('检测到服务器已由 Web 面板启动', 12)
        s.pump(0.8)
        clean = strip_ansi(s.buf)
        assert '自动切至 :mc 实时日志' in clean, '没打印「自动切至 :mc」'
        assert_no_double(clean, 'D')
        assert_clean_exit(clean, 'D')
        n = assert_single_readline(clean, 'D', min_lines=1)
        return 'PASS Web 触发启服时 :wow 自动切 :mc；探针 %d 行 peak<=1' % n
    finally:
        s.close(graceful=False)
        guard.__exit__(None, None, None)


SCENARIOS = (
    ('A', scenario_a),
    ('B', scenario_b),
    ('C', scenario_c),
    ('D', scenario_d),
)


def main():
    which = (sys.argv[1] if len(sys.argv) > 1 else 'ALL').upper()
    todo = [x for x in SCENARIOS if which in ('ALL', x[0])]
    if not todo:
        print('[PTY_RESULT] ok=0 fail=1  未知场景 %r' % which)
        return 1

    root = tempfile.mkdtemp(prefix='wow-pty-')
    signal.alarm(100)                         # 全局天花板
    ok = fail = 0
    try:
        for name, fn in todo:
            try:
                env_dir, env = make_env(root, name)
                msg = fn(root, env)
                if msg.startswith('PASS '):
                    msg = msg[5:]           # 场景返回值不带 PASS，由汇总行统一加
                ok += 1
                print('[SCENARIO %s] PASS %s' % (name, msg))
            except Ceiling:
                fail += 1
                print('[SCENARIO %s] FAIL 全局天花板超时（已有场景卡住，停止后续）' % name)
                break
            except BaseException as e:         # noqa: BLE001 - 单场景失败不影响其它
                fail += 1
                print('[SCENARIO %s] FAIL %s: %s' % (name, type(e).__name__, e))
    finally:
        signal.alarm(0)
        if DUMP:
            for i, s in enumerate(_SESSIONS):
                try:
                    with open('/tmp/wow-pty-s%d.txt' % i, 'w', encoding='utf-8') as f:
                        f.write(strip_ansi(s.buf))
                except OSError:
                    pass
        kill_leftover_fake_java(root)
        shutil.rmtree(root, ignore_errors=True)

    print('[PTY_RESULT] ok=%d fail=%d' % (ok, fail))
    if fail and STRICT:
        return 1
    return 1 if fail else 0


if __name__ == '__main__':
    sys.exit(main())
