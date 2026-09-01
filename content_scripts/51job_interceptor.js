(function() {
    'use strict';

    // 干掉 51job 恶心的 debugger 反调试
    const originalFunction = window.Function;
    window.Function = new Proxy(originalFunction, {
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
    
    function handleInterceptedJson(url, json) {
        // 拦截列表页 JSON (search-pc API)
        if (url.includes('api/job/search-pc') && json && json.resultbody && json.resultbody.job && json.resultbody.job.items) {
            if (json.resultbody.job.items.length >= 10) { // 过滤掉侧边栏推荐位的小量请求
                window.postMessage({
                    type: '51JOB_LIST_DATA',
                    data: json.resultbody.job.items
                }, '*');
            }
        }
        // 拦截详情页 JSON (job-pcdetail API)
        else if (url.includes('api/pc/open/noauth/jobs/job-pcdetail/') && json && json.resultbody && json.resultbody.detailJobInfo) {
            window.__51JOB_DETAIL_DATA__ = json.resultbody;
            // 如果在 iframe 内，将数据打包发给父窗口
            if (window !== window.parent) {
                window.parent.postMessage({
                    type: '51JOB_DETAIL_DATA',
                    jobId: json.resultbody.detailJobInfo.jobId,
                    data: json.resultbody
                }, '*');
            } else {
                // 如果在主窗口单页抓取
                window.postMessage({
                    type: '51JOB_DETAIL_DATA',
                    jobId: json.resultbody.detailJobInfo.jobId,
                    data: json.resultbody
                }, '*');
            }
        }
        // 拦截公司详情 JSON (company-info API)
        else if (url.includes('api/pc/open/noauth/company-info/pc-info') && json && json.resultbody) {
            // 过滤：如果是在顶层窗口（用户直接浏览页面），且当前处于公司主页（/all/co...html）而非纯数字职位详情页，则直接跳过不拦截
            const isCompanyPage = /\/co[a-zA-Z0-9_-]+\.html/i.test(window.location.href) || /\/all\/co/i.test(window.location.href);
            const isJobDetailPage = /\/\d+\.html/i.test(window.location.href);
            if (window === window.parent && (isCompanyPage || !isJobDetailPage)) {
                return;
            }

            window.__51JOB_COMPANY_DATA__ = json.resultbody;
            const coId = (json.resultbody.coinfo) ? (json.resultbody.coinfo.coid || json.resultbody.coinfo.ctmId) : null;
            console.log("🌟 [51job Interceptor] 拦截到公司 API:", url, "提取到的 coId:", coId, "仅保留 resultbody:", json.resultbody);
            if (window !== window.parent) {
                window.parent.postMessage({
                    type: '51JOB_COMPANY_DATA',
                    coId: coId,
                    data: json.resultbody
                }, '*');
            } else {
                window.postMessage({
                    type: '51JOB_COMPANY_DATA',
                    coId: coId,
                    data: json.resultbody
                }, '*');
            }
        }
    }

    // 监听 Isolated World 的数据请求
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === '51JOB_REQUEST_API_CACHE') {
            let extracted = {};
            if (window.__51JOB_DETAIL_DATA__) {
                extracted = window.__51JOB_DETAIL_DATA__;
            }
            window.postMessage({ 
                type: '51JOB_API_CACHE_RETURNED', 
                data: extracted,
                detailData: window.__51JOB_DETAIL_DATA__ || null,
                companyData: window.__51JOB_COMPANY_DATA__ || null
            }, '*');
        }
    });

    // 拦截 Fetch
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        const url = args[0] instanceof Request ? args[0].url : args[0];
        const clone = response.clone();
        clone.text().then(text => {
            try { handleInterceptedJson(url, JSON.parse(text)); } catch (e) {}
        });
        return response;
    };

    // 拦截 XHR
    const originalXHRSend = XMLHttpRequest.prototype.send;
    const originalXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        this._interceptUrl = url;
        return originalXHROpen.apply(this, [method, url, ...args]);
    };
    XMLHttpRequest.prototype.send = function(...args) {
        this.addEventListener('load', function() {
            try { handleInterceptedJson(this._interceptUrl, JSON.parse(this.responseText)); } catch (e) {}
        });
        return originalXHRSend.apply(this, args);
    };

})();
