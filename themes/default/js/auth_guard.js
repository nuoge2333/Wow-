/**
 * wowAuthGuard() —— Web 面板统一登录闸门
 *
 * 后端新增 web.require_login（默认 false）。false 时静态页与所有 /api/*
 * 都无需 token；true（或面板对外暴露 / 开了隧道被自动强制）时恢复登录页。
 *
 * 页面在启动时 `await wowAuthGuard()`：
 *   true  → 继续渲染；
 *   false → 已跳转 /login.html，后续初始化不要跑。
 *
 * 查询 /api/auth/mode 失败时保守回退到旧的登录检查，避免后端是旧版本时
 * 把本该登录的面板敞开。
 */
async function wowAuthGuard() {
    let requireLogin = true;
    try {
        const res = await fetch('/api/auth/mode', { credentials: 'same-origin' });
        if (res.ok) {
            const mode = await res.json();
            requireLogin = mode.require_login !== false;
        }
    } catch (e) {
        // 取不到 mode：按「需要登录」处理（保守）
    }
    if (!requireLogin) return true;   // 完全免登录

    const token = sessionStorage.getItem('wow_token');
    if (!token) {
        window.location.href = '/login.html';
        return false;
    }
    try {
        const res = await fetch('/api/auth/verify', {
            headers: { 'Authorization': 'Bearer ' + token },
            credentials: 'same-origin'
        });
        const data = await res.json();
        if (!data.valid) {
            sessionStorage.removeItem('wow_token');
            window.location.href = '/login.html';
            return false;
        }
        return true;
    } catch (e) {
        window.location.href = '/login.html';
        return false;
    }
}
