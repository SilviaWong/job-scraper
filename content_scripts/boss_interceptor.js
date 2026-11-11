// 注入到 MAIN world，用于无痕拦截 XHR/Fetch、检测风控响应并清理自动化 URL 参数
(function() {
    'use strict';

    if (window !== window.parent) return; // 不在 iframe 中运行

    const BRIDGE_EVENT_NAME = '__zp_ext_bridge__';

    // 1. 在 document_start 阶段立即净化 URL 中的自动化特征参数 (auto_close / close_delay)
    // 防止 Boss 直聘前端埋点 (ka.js / security.js) 将带有自动化参数的 location.href 上报给风控服务端
    try {
        if (location.search && (location.search.includes('auto_close=') || location.search.includes('close_delay='))) {
            const urlObj = new URL(location.href);
            const autoClose = urlObj.searchParams.get('auto_close');
            const closeDelay = urlObj.searchParams.get('close_delay');
            if (autoClose === '1') {
                const parsedDelay = parseInt(closeDelay, 10);
                const finalDelay = (!isNaN(parsedDelay) && parsedDelay > 0)
                    ? parsedDelay
                    : (Math.floor(Math.random() * (5000 - 2500 + 1)) + 2500);
                try {
                    sessionStorage.setItem('__zp_ac_delay__', String(finalDelay));
                } catch (e) {}
            }
            urlObj.searchParams.delete('auto_close');
            urlObj.searchParams.delete('close_delay');
            const cleanUrl = urlObj.pathname + (urlObj.search ? urlObj.search : '') + urlObj.hash;
            window.history.replaceState(window.history.state, '', cleanUrl);
        }
    } catch (e) {}

    // 2. 保护原生函数的 toString 指纹，防止反爬脚本通过 Function.prototype.toString 检测 Hook
    const nativeToString = Function.prototype.toString;
    const spoofedFns = new WeakMap();

    function maskAsNative(fn, nativeFn) {
        try {
            spoofedFns.set(fn, nativeToString.call(nativeFn));
        } catch (e) {}
        return fn;
    }

    try {
        const customToString = function toString() {
            if (spoofedFns.has(this)) {
                return spoofedFns.get(this);
            }
            return nativeToString.apply(this, arguments);
        };
        maskAsNative(customToString, nativeToString);
        Function.prototype.toString = customToString;
    } catch (e) {}

    // 3. 使用 CustomEvent 替代 window.postMessage，避免被页面自身的 message 监听器捕获
    function emitToIsolated(type, url, data) {
        try {
            const payload = JSON.stringify({ type, url, data });
            window.dispatchEvent(new CustomEvent(BRIDGE_EVENT_NAME, { detail: payload }));
        } catch (e) {}
    }

    const RISK_MSG_REGEX = /验证|异常|频繁|安全|风控|行为|滑动|受限|封禁|verify|captcha/i;
    const RISK_CODES = new Set([9, 35, 36, 37, 403, 429]);

    function handleApiResponseText(urlStr, text) {
        if (!text) return;
        try {
            const json = JSON.parse(text);
            if (!json || typeof json !== 'object') return;

            // 检测 Boss 接口层面的风控响应（如 code: 37 滑块验证等）
            if (urlStr && urlStr.includes('wapi/') && json.code !== undefined && json.code !== 0) {
                const msg = String(json.message || json.msg || '');
                if (RISK_CODES.has(Number(json.code)) || RISK_MSG_REGEX.test(msg) || (json.zpData && json.zpData.bizCode)) {
                    emitToIsolated('BOSS_RISK_CONTROL', urlStr, {
                        code: json.code,
                        message: msg || `接口返回异常状态码 (${json.code})`
                    });
                    return;
                }
            }

            const data = json.zpData || json.data;
            if (data) {
                if (data.jobInfo) {
                    emitToIsolated('BOSS_JOB_DETAIL', urlStr, json);
                } else if (data.jobList) {
                    emitToIsolated('BOSS_JOB_LIST', urlStr, json);
                } else if (data.brandInfo || data.companyInfo || data.brandComInfo) {
                    emitToIsolated('BOSS_COMPANY_DETAIL', urlStr, json);
                }
            }
        } catch (e) {}
    }

    // 4. 无痕拦截 window.fetch
    const originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
        const hookedFetch = async function(...args) {
            const response = await originalFetch.apply(this, args);
            try {
                const urlStr = typeof args[0] === 'string'
                    ? args[0]
                    : (args[0] && args[0].url ? args[0].url : String(args[0] || ''));
                if (urlStr.includes('wapi/') || urlStr.includes('job') || urlStr.includes('geek')) {
                    response.clone().text().then(text => {
                        handleApiResponseText(urlStr, text);
                    }).catch(() => {});
                }
            } catch (e) {}
            return response;
        };
        window.fetch = maskAsNative(hookedFetch, originalFetch);
    }

    // 5. 无痕拦截 XMLHttpRequest（使用 WeakMap 存储私有元数据，不在实例上挂载 _bossUrl 属性）
    const xhrUrlMap = new WeakMap();
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    const hookedOpen = function(method, url, ...args) {
        try {
            xhrUrlMap.set(this, String(url || ''));
        } catch (e) {}
        return origOpen.apply(this, [method, url, ...args]);
    };

    const hookedSend = function(...args) {
        try {
            this.addEventListener('load', () => {
                try {
                    const urlStr = xhrUrlMap.get(this) || this.responseURL || '';
                    if (!urlStr.includes('wapi/') && !urlStr.includes('job') && !urlStr.includes('geek')) {
                        return;
                    }
                    const text = this.responseType === 'json'
                        ? JSON.stringify(this.response)
                        : this.responseText;
                    handleApiResponseText(urlStr, text);
                } catch (e) {}
            });
        } catch (e) {}
        return origSend.apply(this, args);
    };

    XMLHttpRequest.prototype.open = maskAsNative(hookedOpen, origOpen);
    XMLHttpRequest.prototype.send = maskAsNative(hookedSend, origSend);
})();
