/**
 * Web 面板内置帮助文档查看器（纯前端展示）
 * ----------------------------------------------------------------
 * 安全设计（尚书省指令 P0 红线）：
 *   1. 后端只给 Markdown 原文，前端 marked 渲染后必须经过 DOMPurify 清洗，
 *      才允许写入 innerHTML；渲染库缺失或异常时降级为纯文本（fail-closed）。
 *   2. 渲染区所有 <a> 点击统一拦截：内部 .md 链接在抽屉内切换文档，
 *      外部链接强制 target=_blank + rel=noopener noreferrer 新开标签页，
 *      未开放文档与危险协议一律不跳出面板。
 *   3. 文档内相对图片重写到受控的 /api/docs/asset?name=&file= 接口，
 *      绝不把文档原始相对路径直接交给浏览器解析。
 *   4. 目录标题一律用 textContent 写入，不拼 HTML。
 *
 * 依赖（本地 vendor，离线可用，不依赖任何 CDN）：
 *   /js/vendor/marked.min.js   → window.marked
 *   /js/vendor/purify.min.js   → window.DOMPurify
 */

(function () {
    'use strict';

    const LIST_URL = '/api/docs/list';
    const CONTENT_URL = '/api/docs/content?name=';
    const ASSET_URL = '/api/docs/asset';

    let docs = [];
    let groups = [];
    let loaded = false;
    let current = null;

    let overlay = null;
    let nav = null;
    let content = null;
    let toast = null;
    let toastTimer = null;

    // ============ 基础工具 ============

    function byId(id) { return document.getElementById(id); }

    function token() {
        try { return sessionStorage.getItem('wow_token') || ''; }
        catch (e) { return ''; }
    }

    async function api(url) {
        const r = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + token() },
            credentials: 'same-origin'
        });
        let data = null;
        try { data = await r.json(); } catch (e) { /* 非 JSON 响应 */ }
        return { status: r.status, data: data || {} };
    }

    function showToast(msg) {
        if (!toast) return;
        toast.textContent = msg;                 // textContent，绝不拼 HTML
        toast.classList.add('show');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
    }

    /** 归一化文档名：忽略大小写、连字符与下划线的差异 */
    function normName(s) {
        return String(s || '').toUpperCase().replace(/[-_]/g, '');
    }

    /** GitHub 风格标题锚点（保留中文与连字符，用于文档内互跳） */
    function slug(s) {
        return String(s || '').trim().toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^\w\u4e00-\u9fff-]/g, '');
    }

    function resolveDocName(base) {
        const n = normName(base);
        if (!n) return null;
        const hit = docs.find(d => normName(d.name) === n);
        return hit ? hit.name : null;
    }

    // ============ 目录 ============

    async function loadList() {
        let r;
        try { r = await api(LIST_URL); }
        catch (e) { r = { status: 0, data: {} }; }
        if (r.status !== 200 || !r.data.success || !Array.isArray(r.data.docs)) {
            nav.textContent = '';
            const tip = document.createElement('div');
            tip.className = 'docs-nav-empty';
            tip.textContent = '文档目录加载失败';
            nav.appendChild(tip);
            return false;
        }
        docs = r.data.docs;
        groups = Array.isArray(r.data.groups) ? r.data.groups : [];
        renderNav();
        loaded = true;
        return true;
    }

    function renderNav() {
        nav.textContent = '';
        const order = groups.slice();
        docs.forEach(d => { if (!order.includes(d.group)) order.push(d.group); });

        order.forEach(g => {
            const items = docs.filter(d => d.group === g);
            if (!items.length) return;
            const box = document.createElement('div');
            box.className = 'docs-nav-group';
            const title = document.createElement('div');
            title.className = 'docs-nav-group-title';
            title.textContent = g;
            box.appendChild(title);
            items.forEach(d => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'docs-nav-item';
                btn.dataset.name = d.name;
                btn.textContent = d.title;      // 目录标题绝不拼 HTML
                box.appendChild(btn);
            });
            nav.appendChild(box);
        });
    }

    function markActive(name) {
        nav.querySelectorAll('.docs-nav-item').forEach(b => {
            b.classList.toggle('active', b.dataset.name === name);
        });
    }

    // ============ 渲染 ============

    /** 把一篇文档的 Markdown 原文安全地渲染进右侧区域 */
    function renderMarkdown(md) {
        const hasLibs = !!(window.marked && typeof window.marked.parse === 'function' &&
            window.DOMPurify && typeof window.DOMPurify.sanitize === 'function');
        if (!hasLibs) {
            // fail-closed：库没加载成功时只显示纯文本，绝不 innerHTML 原文
            const pre = document.createElement('pre');
            pre.className = 'docs-plain';
            pre.textContent = String(md || '');
            content.textContent = '';
            content.appendChild(pre);
            showToast('渲染组件未加载，已降级为纯文本显示');
            return;
        }
        let clean;
        try {
            const raw = window.marked.parse(String(md || ''));
            clean = window.DOMPurify.sanitize(raw, {
                USE_PROFILES: { html: true },
                FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'input', 'object', 'embed', 'link', 'meta', 'base'],
                FORBID_ATTR: ['style', 'srcdoc', 'formaction']
            });
        } catch (e) {
            const pre = document.createElement('pre');
            pre.className = 'docs-plain';
            pre.textContent = String(md || '');
            content.textContent = '';
            content.appendChild(pre);
            showToast('文档渲染异常，已降级为纯文本显示');
            return;
        }
        // 唯一一处写入 innerHTML：内容已经过 DOMPurify 清洗
        content.innerHTML = clean;
        postProcess();
    }

    /** 清洗之后的后处理：标题锚点、图片路径重写、链接属性与协议兜底 */
    function postProcess() {
        // 1) 为标题生成锚点 id，支持同文档 #锚点 与跨文档 CONFIG.md#xxx
        content.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
            if (!h.id) {
                const s = slug(h.textContent);
                if (s) h.id = s;
            }
        });

        // 2) 相对图片 → 受控 asset 接口（只取 basename，绝不保留 ../ 路径）
        content.querySelectorAll('img').forEach(img => {
            const src = img.getAttribute('src') || '';
            if (!src || /^(https?:|data:|\/)/i.test(src)) return;
            let file = src.split(/[\\/]/).pop().split('#')[0].split('?')[0];
            if (!file) return;
            img.setAttribute('src', ASSET_URL + '?name=' + encodeURIComponent(current || '') +
                '&file=' + encodeURIComponent(file));
            img.setAttribute('loading', 'lazy');
        });

        // 3) 链接分类与危险协议兜底（DOMPurify 已清一轮，这里再兜一层）
        content.querySelectorAll('a').forEach(a => {
            const href = a.getAttribute('href') || '';
            if (/^(javascript|vbscript|data):/i.test(href)) {
                a.removeAttribute('href');
                a.setAttribute('data-docs-blocked', '1');
                return;
            }
            if (/^(https?:|mailto:)/i.test(href)) {
                a.setAttribute('target', '_blank');
                a.setAttribute('rel', 'noopener noreferrer');
                a.classList.add('docs-link-external');
            } else if (/\.md(#.*)?$/i.test(href) || href.charAt(0) === '#') {
                a.classList.add('docs-link-internal');
            }
        });
    }

    function scrollToAnchor(anchor) {
        if (!anchor) return;
        let a = anchor;
        try { a = decodeURIComponent(anchor); } catch (e) { /* 保留原值 */ }
        let target = null;
        try { target = content.querySelector('#' + CSS.escape(a)); } catch (e) { /* 忽略非法选择器 */ }
        if (!target) {
            const want = slug(a);
            target = Array.from(content.querySelectorAll('h1,h2,h3,h4,h5,h6'))
                .find(h => slug(h.textContent) === want) || null;
        }
        if (target) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }

    /** 切换文档（目录点击或文内链接触发） */
    async function selectDoc(name, anchor) {
        if (!name) return;
        current = name;
        markActive(name);
        content.textContent = '';
        const loading = document.createElement('div');
        loading.className = 'docs-loading';
        loading.textContent = '正在加载文档…';
        content.appendChild(loading);

        let r;
        try { r = await api(CONTENT_URL + encodeURIComponent(name)); }
        catch (e) { r = { status: 0, data: {} }; }
        if (r.status !== 200 || !r.data.success) {
            content.textContent = '';
            const box = document.createElement('div');
            box.className = 'docs-error';
            box.textContent = '文档读取失败，请前往仓库查看';
            content.appendChild(box);
            return;
        }
        renderMarkdown(r.data.content);
        if (anchor) scrollToAnchor(anchor);
        else content.scrollTop = 0;
    }

    // ============ 链接点击拦截（事件委托，覆盖渲染区内所有 a） ============

    function onContentClick(e) {
        const node = e.target;
        const a = node && node.closest ? node.closest('a') : null;
        if (!a || !content.contains(a)) return;
        const href = a.getAttribute('href') || '';

        // 外链：已设 target=_blank + rel，交给浏览器新开标签页
        if (/^(https?:|mailto:)/i.test(href)) return;

        // 纯锚点：在渲染区内滚动
        if (href.charAt(0) === '#') {
            e.preventDefault();
            scrollToAnchor(href.slice(1));
            return;
        }

        // 内部 .md 链接：映射白名单文档名，抽屉内切换
        if (/\.md(#.*)?$/i.test(href)) {
            e.preventDefault();
            const parts = href.split('#');
            const base = parts[0].split(/[\\/]/).pop().replace(/\.md$/i, '');
            const target = resolveDocName(base);
            if (!target) {
                showToast('该文档未开放，请前往仓库查看');
                return;
            }
            selectDoc(target, parts.length > 1 ? parts.slice(1).join('#') : '');
            return;
        }

        // 其余相对链接（含被拦截的危险协议）：一律不跳出面板
        if (href) {
            e.preventDefault();
            showToast('该链接未在文档查看器内开放');
        }
    }

    // ============ 开关 ============

    async function open() {
        if (!overlay) return;
        overlay.classList.add('open');
        overlay.setAttribute('aria-hidden', 'false');
        if (!loaded) {
            const ok = await loadList();
            if (!ok) {
                content.textContent = '';
                const box = document.createElement('div');
                box.className = 'docs-error';
                box.textContent = '文档读取失败，请前往仓库查看';
                content.appendChild(box);
                return;
            }
        }
        if (docs.length && (!current || !docs.find(d => d.name === current))) {
            await selectDoc(docs[0].name);
        }
    }

    function close() {
        if (!overlay) return;
        overlay.classList.remove('open');
        overlay.setAttribute('aria-hidden', 'true');
    }

    function isOpen() { return !!(overlay && overlay.classList.contains('open')); }

    // ============ 初始化 ============

    function init() {
        overlay = byId('docs-overlay');
        nav = byId('docs-nav');
        content = byId('docs-content');
        toast = byId('docs-toast');
        if (!overlay || !nav || !content) return;

        const closeBtn = byId('docs-close-btn');
        if (closeBtn) closeBtn.addEventListener('click', close);

        // 点遮罩层关闭（只认遮罩本身，点抽屉内部不关）
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        // Esc 关闭
        document.addEventListener('keydown', e => {
            if ((e.key === 'Escape' || e.key === 'Esc') && isOpen()) close();
        });

        // 目录点击
        nav.addEventListener('click', e => {
            const btn = e.target && e.target.closest ? e.target.closest('.docs-nav-item') : null;
            if (btn) selectDoc(btn.dataset.name);
        });

        // 渲染区所有 a 的点击统一拦截
        content.addEventListener('click', onContentClick);

        // 侧边栏 / 左下角入口按钮通过 postMessage 请求打开（同源校验）
        window.addEventListener('message', e => {
            if (e.origin !== window.location.origin) return;
            if (e.data && e.data.type === 'open-docs') open();
            else if (e.data && e.data.type === 'close-docs') close();
        });

        // 暴露全局，便于其它页面/控制台调用
        window.wowDocs = { open, close, isOpen, selectDoc, renderMarkdown };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
