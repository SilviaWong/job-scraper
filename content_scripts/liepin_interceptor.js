(function() {
    'use strict';

    // 拦截搜索列表 JSON
    function handleInterceptedJson(url, json) {
        let jobs = [];
        try {
            // 搜索页: www.liepin.com/zhaopin/
            if (url.includes('com.liepin.searchfront4c.pc-search-job') && json && json.data && json.data.data && json.data.data.jobCardList) {
                jobs = json.data.data.jobCardList;
            } 
            // 首页瀑布流: c.liepin.com (直接数组)
            else if ((url.includes('api-batch/parallel') || url.includes('home-recommend-job-new')) && json && json.data) {
                if (Array.isArray(json.data)) {
                    jobs = json.data;
                } else if (json.data.data && Array.isArray(json.data.data)) {
                    jobs = json.data.data;
                }
                // 首页瀑布流: 嵌套对象
                else if (json.data["com.liepin.csearch.home-recommend-job-new"]) {
                    const nested = json.data["com.liepin.csearch.home-recommend-job-new"];
                    if (nested && nested.data && Array.isArray(nested.data.data)) {
                        jobs = nested.data.data;
                    }
                }
            }
        } catch (e) {
            console.error("解析 JSON 错误:", e);
        }

        if (jobs.length > 0) {
            // 如果在 iframe 内，将数据打包发给父窗口
            if (window !== window.parent) {
                window.parent.postMessage({
                    type: 'LIEPIN_LIST_DATA',
                    data: jobs
                }, '*');
            } else {
                // 如果在主窗口
                window.postMessage({
                    type: 'LIEPIN_LIST_DATA',
                    data: jobs
                }, '*');
            }
            console.log("✅ [猎聘拦截器] 成功截获职位列表数据!", jobs.length, "条");
        }
    }

    // 拦截 Fetch
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        try {
            const url = args[0] instanceof Request ? args[0].url : args[0];
            const clone = response.clone();
            clone.text().then(text => {
                try {
                    handleInterceptedJson(url, JSON.parse(text));
                } catch (e) {}
            });
        } catch (e) {
            console.error("Fetch 拦截错误:", e);
        }
        return response;
    };

    // 拦截 XHR
    const originalXHRSend = XMLHttpRequest.prototype.send;
    const originalXHROpen = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        this._interceptedUrl = url;
        return originalXHROpen.apply(this, [method, url, ...args]);
    };

    XMLHttpRequest.prototype.send = function(...args) {
        this.addEventListener('load', function() {
            try {
                if (this.responseType === '' || this.responseType === 'text' || this.responseType === 'json') {
                    let responseText = this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText;
                    if (responseText) {
                        try {
                            handleInterceptedJson(this._interceptedUrl, JSON.parse(responseText));
                        } catch (e) {}
                    }
                }
            } catch (e) {}
        });
        return originalXHRSend.apply(this, args);
    };

})();
