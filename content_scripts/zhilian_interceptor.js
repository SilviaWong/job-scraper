(function() {
    'use strict';

    if (window !== window.parent) return; // 不在 iframe 中运行

    function handleInterceptedJson(urlStr, json) {
        try {
            if (!json || typeof json !== 'object') return;

            // 1. 职位详情接口（支持 position-detail-new, position-detailv3, position-detail 以及返回结构特征判断）
            const isDetailUrl = urlStr.includes('position-detail') || urlStr.includes('position/detail') || urlStr.includes('jobdetail');
            const hasDetailData = !!(json?.data?.detailedPosition || json?.detailedPosition || json?.jobDetail?.detailedPosition || (json?.data && json.data.detailedCompany && json.data.detailedPosition));
            if (isDetailUrl || hasDetailData) {
                window.postMessage({ type: 'ZHILIAN_JOB_DETAIL', url: urlStr, data: json }, '*');
                console.log("✅ [智联拦截器] 成功截获职位详情数据!", urlStr);
                return;
            }

            // 2. 职位列表接口
            const isListUrl = urlStr.includes('search/positions') || urlStr.includes('search/joblist') || urlStr.includes('position/recommend-tag') || urlStr.includes('position/list');
            const hasListData = !!(Array.isArray(json?.data?.list) || Array.isArray(json?.data?.data?.list) || Array.isArray(json?.positionList) || Array.isArray(json?.data?.positionList));
            if (isListUrl || hasListData) {
                window.postMessage({ type: 'ZHILIAN_JOB_LIST', url: urlStr, data: json }, '*');
                console.log("✅ [智联拦截器] 成功截获职位列表数据!", urlStr);
                return;
            }
        } catch (e) {}
    }

    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        try {
            const urlStr = String(args[0] instanceof Request ? args[0].url : args[0]);
            const clone = response.clone();
            clone.text().then(text => {
                try {
                    handleInterceptedJson(urlStr, JSON.parse(text));
                } catch(e) {}
            });
        } catch(e) {}
        return response;
    };

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        this._zhilianUrl = String(url);
        return origOpen.apply(this, [method, url, ...args]);
    };

    XMLHttpRequest.prototype.send = function(...args) {
        this.addEventListener('load', function() {
            try {
                if (this.responseType === '' || this.responseType === 'text' || this.responseType === 'json') {
                    const text = this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText;
                    if (!text) return;
                    handleInterceptedJson(this._zhilianUrl, JSON.parse(text));
                }
            } catch(e) {}
        });
        return origSend.apply(this, args);
    };

    console.log('[Zhilian Scraper] XHR/Fetch Interceptor injected.');
})();
