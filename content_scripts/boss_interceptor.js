// 注入到 MAIN world，用于拦截 XHR/Fetch
(function() {
    'use strict';

    if (window !== window.parent) return; // 不在 iframe 中运行

    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        try {
            const urlStr = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : String(args[0] || ''));
            if (urlStr.includes('wapi/zpgeek/')) {
                console.log('[Boss Interceptor] Detected fetch:', urlStr);
            }

            response.clone().text().then(text => {
                try {
                    const json = JSON.parse(text);
                    const data = json.zpData || json.data;
                    if (data) {
                        if (data.jobInfo) {
                            window.postMessage({ type: 'BOSS_JOB_DETAIL', url: urlStr, data: json }, '*');
                        } else if (data.jobList) {
                            window.postMessage({ type: 'BOSS_JOB_LIST', url: urlStr, data: json }, '*');
                        } else if (data.brandInfo || data.companyInfo || data.brandComInfo) {
                            window.postMessage({ type: 'BOSS_COMPANY_DETAIL', url: urlStr, data: json }, '*');
                        }
                    }
                } catch(e) {}
            });
        } catch(e) {}
        return response;
    };

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        this._bossUrl = String(url);
        return origOpen.apply(this, [method, url, ...args]);
    };

    XMLHttpRequest.prototype.send = function(...args) {
        if (this._bossUrl && this._bossUrl.includes('wapi/zpgeek/')) {
            console.log('[Boss Interceptor] Detected XHR:', this._bossUrl);
        }
        this.addEventListener('load', () => {
            try {
                const text = this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText;
                if (!text) return;
                const json = JSON.parse(text);
                const data = json.zpData || json.data;
                if (data) {
                    if (data.jobInfo) {
                        window.postMessage({ type: 'BOSS_JOB_DETAIL', url: this._bossUrl, data: json }, '*');
                    } else if (data.jobList) {
                        window.postMessage({ type: 'BOSS_JOB_LIST', url: this._bossUrl, data: json }, '*');
                    } else if (data.brandInfo || data.companyInfo || data.brandComInfo) {
                        window.postMessage({ type: 'BOSS_COMPANY_DETAIL', url: this._bossUrl, data: json }, '*');
                    }
                }
            } catch(e) {}
        });
        return origSend.apply(this, args);
    };

    console.log('[Boss Scraper] XHR/Fetch Interceptor injected.');
})();
