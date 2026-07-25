/**
 * wow Web 面板 - 全局 JavaScript
 * 提供 API 调用、通知、工具函数等
 */

(function() {
    'use strict';

    // ============ 配置 ============
    const API_BASE = '/api';

    // ============ 工具函数 ============

    // 获取存储的 token
    function getToken() {
        return sessionStorage.getItem('wow_token') || '';
    }

    // 发送 API 请求
    async function apiRequest(endpoint, method = 'GET', body = null) {
        const url = API_BASE + endpoint;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + getToken()
        };
        const options = {
            method,
            headers,
            credentials: 'same-origin'
        };
        if (body) {
            options.body = JSON.stringify(body);
        }
        const response = await fetch(url, options);
        if (!response.ok) {
            const text = await response.text();
            let errMsg = '请求失败';
            try {
                const data = JSON.parse(text);
                errMsg = data.error || data.message || text;
            } catch (e) {
                errMsg = text || '请求失败';
            }
            throw new Error(errMsg);
        }
        return response.json();
    }

    // 发送通知到右侧通知栏
    function notify(level, message) {
        const frame = document.getElementById('notify-frame');
        if (frame && frame.contentWindow) {
            frame.contentWindow.postMessage({ type: 'notify', level, message }, '*');
        } else {
            console.warn('通知栏未就绪:', level, message);
        }
    }

    // 执行 CLI 命令
    async function execCommand(command, args = []) {
        return apiRequest('/exec', 'POST', { command, args });
    }

    // 获取服务器状态
    async function getServerStatus() {
        return apiRequest('/status');
    }

    // 获取配置
    async function getConfig(key = null) {
        if (key) {
            return apiRequest('/config/' + encodeURIComponent(key));
        } else {
            return apiRequest('/config');
        }
    }

    // 设置配置
    async function setConfig(key, value) {
        return apiRequest('/config', 'POST', { key, value });
    }

    // 获取日志
    async function getLogs(lines = 50) {
        return apiRequest('/logs?lines=' + lines);
    }

    // 获取模组列表
    async function getMods() {
        return apiRequest('/mods');
    }

    // 获取方案列表
    async function getSchemes() {
        return apiRequest('/schemes');
    }

    // 获取主题列表
    async function getThemes() {
        return apiRequest('/themes');
    }

    // ============ 暴露全局 API ============
    window.wow = {
        getToken,
        apiRequest,
        notify,
        execCommand,
        getServerStatus,
        getConfig,
        setConfig,
        getLogs,
        getMods,
        getSchemes,
        getThemes
    };

    // ============ 通知栏就绪处理 ============
    window.addEventListener('message', function(event) {
        if (event.origin !== window.location.origin) return;
        if (event.data.type === 'notify-ready') {
            // 可以在这里发送初始化通知
        }
    });

    console.log('wow Web 面板已加载');
})();