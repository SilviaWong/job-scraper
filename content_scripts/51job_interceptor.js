(function() {
    'use strict';

    const BRIDGE_EVENT_NAME = '__51job_ext_bridge__';

    // 1. 在 document_start 阶段立即净化 URL 中的自动化特征参数 (auto_close / close_delay)
    // 防止 51job 前端神策分析埋点 (Sensors Analytics) 将带有自动化参数的 URL 上报给风控服务端
    try {
        if (location.search && (location.search.includes('auto_close=') || location.search.includes('close_delay='))) {
            const urlObj = new URL(location.href);
            const autoClose = urlObj.searchParams.get('auto_close');
            const closeDelay = urlObj.searchParams.get('close_delay');
            if (autoClose === '1') {
                const parsedDelay = parseInt(closeDelay, 10);
                const finalDelay = (!isNaN(parsedDelay) && parsedDelay > 0)
                    ? parsedDelay
                    : (Math.floor(Math.random() * (4500 - 2200 + 1)) + 2200);
                try {
                    sessionStorage.setItem('__51job_ac_delay__', String(finalDelay));
                } catch (e) {}
            }
            urlObj.searchParams.delete('auto_close');
            urlObj.searchParams.delete('close_delay');
            const cleanUrl = urlObj.pathname + (urlObj.search ? urlObj.search : '') + urlObj.hash;
            window.history.replaceState(window.history.state, '', cleanUrl);
        }
    } catch (e) {}

    // 2. 原生函数 toString 指纹伪装，防止反爬脚本探测 Hook
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

    // 3. 干掉 51job 反调试 debugger
    const originalFunction = window.Function;
    const customFunction = new Proxy(originalFunction, {
        construct(target, args) {
            if (args.length > 0 && typeof args[args.length - 1] === 'string' && args[args.length - 1].includes('debugger')) {
                return function() {}; 
            }
            return new target(...args);
        },
        apply(target, thisArg, args) {
            if (args.length > 0 && typeof args[args.length - 1] === 'string' && args[args.length - 1].includes('debugger')) {
                return function() {}; 
            }
            return target.apply(thisArg, args);
        }
    });
    maskAsNative(customFunction, originalFunction);
    window.Function = customFunction;

    // 4. 双通道发送事件：首选隐蔽 CustomEvent，兼顾兼容 window.postMessage
    function emitPayload(payload, targetWindow = window) {
        try {
            const detailStr = JSON.stringify(payload);
            window.dispatchEvent(new CustomEvent(BRIDGE_EVENT_NAME, { detail: detailStr }));
        } catch (e) {}

        try {
            targetWindow.postMessage(payload, '*');
        } catch (e) {}
    }

    function handleInterceptedJson(url, json) {
        if (!json || typeof json !== 'object') return;
        const urlStr = String(url || '');

        // 拦截列表页 JSON (search-pc API)
        // 修复：移除原先 >= 10 的硬编码过滤，只要是主 search-pc 接口返回的合法 items 均正常提取
        if (urlStr.includes('api/job/search-pc') && json.resultbody && json.resultbody.job && Array.isArray(json.resultbody.job.items)) {
            const items = json.resultbody.job.items;
            emitPayload({
                type: '51JOB_LIST_DATA',
                data: items,
                totalCount: json.resultbody.job.totalJobCount || json.resultbody.job.totalCount || items.length
            });
        }
        // 拦截详情页 JSON (job-pcdetail API)
        else if (urlStr.includes('api/pc/open/noauth/jobs/job-pcdetail/') && json.resultbody && json.resultbody.detailJobInfo) {
            window.__51JOB_DETAIL_DATA__ = json.resultbody;
            const targetWin = (window !== window.parent) ? window.parent : window;
            emitPayload({
                type: '51JOB_DETAIL_DATA',
                jobId: json.resultbody.detailJobInfo.jobId,
                data: json.resultbody
            }, targetWin);
        }
        // 拦截公司详情 JSON (company-info API)
        else if (urlStr.includes('api/pc/open/noauth/company-info/pc-info') && json.resultbody) {
            // 过滤：如果是在顶层窗口（用户直接浏览页面），且当前处于公司主页（/all/co...html）而非纯数字职位详情页，则直接跳过不拦截
            const isCompanyPage = /\/co[a-zA-Z0-9_-]+\.html/i.test(window.location.href) || /\/all\/co/i.test(window.location.href);
            const isJobDetailPage = /\/\d+\.html/i.test(window.location.href);
            if (window === window.parent && (isCompanyPage || !isJobDetailPage)) {
                return;
            }

            window.__51JOB_COMPANY_DATA__ = json.resultbody;
            const coId = (json.resultbody.coinfo) ? (json.resultbody.coinfo.coid || json.resultbody.coinfo.ctmId) : null;
            const targetWin = (window !== window.parent) ? window.parent : window;
            emitPayload({
                type: '51JOB_COMPANY_DATA',
                coId: coId,
                data: json.resultbody
            }, targetWin);
        }
    }

    // 监听 Isolated World 的数据请求
    function handleCacheRequest() {
        let extracted = {};
        if (window.__51JOB_DETAIL_DATA__) {
            extracted = window.__51JOB_DETAIL_DATA__;
        }
        emitPayload({ 
            type: '51JOB_API_CACHE_RETURNED', 
            data: extracted,
            detailData: window.__51JOB_DETAIL_DATA__ || null,
            companyData: window.__51JOB_COMPANY_DATA__ || null
        });
    }

    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === '51JOB_REQUEST_API_CACHE') {
            handleCacheRequest();
        }
    });

    window.addEventListener(BRIDGE_EVENT_NAME, (event) => {
        try {
            const data = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
            if (data && data.type === '51JOB_REQUEST_API_CACHE') {
                handleCacheRequest();
            }
        } catch (e) {}
    });

    // 5. 拦截 Fetch (带 toString 原生指纹伪装)
    const originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
        const hookedFetch = async function(...args) {
            const response = await originalFetch.apply(this, args);
            try {
                const url = args[0] instanceof Request ? args[0].url : args[0];
                const urlStr = String(url || '');
                if (urlStr.includes('api/job/') || urlStr.includes('api/pc/open/')) {
                    response.clone().text().then(text => {
                        try { handleInterceptedJson(urlStr, JSON.parse(text)); } catch (e) {}
                    }).catch(() => {});
                }
            } catch (e) {}
            return response;
        };
        window.fetch = maskAsNative(hookedFetch, originalFetch);
    }

    // 6. 拦截 XHR (使用 WeakMap 记录 URL，不向 XHR 实例写入 _interceptUrl 自定义属性)
    const xhrUrlMap = new WeakMap();
    const originalXHRSend = XMLHttpRequest.prototype.send;
    const originalXHROpen = XMLHttpRequest.prototype.open;

    const hookedOpen = function(method, url, ...args) {
        try {
            xhrUrlMap.set(this, String(url || ''));
        } catch (e) {}
        return originalXHROpen.apply(this, [method, url, ...args]);
    };

    const hookedSend = function(...args) {
        try {
            this.addEventListener('load', () => {
                try {
                    const urlStr = xhrUrlMap.get(this) || this.responseURL || '';
                    if (urlStr.includes('api/job/') || urlStr.includes('api/pc/open/')) {
                        const text = this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText;
                        if (text) handleInterceptedJson(urlStr, JSON.parse(text));
                    }
                } catch (e) {}
            });
        } catch (e) {}
        return originalXHRSend.apply(this, args);
    };

    XMLHttpRequest.prototype.open = maskAsNative(hookedOpen, originalXHROpen);
    XMLHttpRequest.prototype.send = maskAsNative(hookedSend, originalXHRSend);

})();
