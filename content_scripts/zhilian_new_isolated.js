(function () {
    'use strict';

    if (window !== window.parent) return;

    let isRunning = false;
    let isAutoScroll = true;
    let skipScraped = true;
    let scrapedIdsCache = new Set();
    let currentList = [];
    let currentIndex = 0;
    let scrapedData = [];
    let scrapedIds = new Set();
    let sessionProcessedIds = new Set(); // Track jobs processed in current run to prevent infinite loops
    let interceptedListJobs = new Map();
    let interceptedDetailJobs = new Map(); // Store intercepted list JSON items
    let waitTimer = null;
    let jobsScrapedSinceRest = 0;

    function getRandomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

    function cleanStr(str) {
        if (str == null) return '';
        if (Array.isArray(str)) str = str.join(' / ');
        return String(str).replace(/[\r\n]+/g, ' ').replace(/"/g, '""').trim();
    }

    function extractInitialState() {
        try {
            const scripts = document.querySelectorAll('script');
            let stateJson = null;
            for (let s of scripts) {
                if (s.innerHTML.includes('__INITIAL_STATE__')) {
                    const str = s.innerHTML.trim();
                    const prefix = '__INITIAL_STATE__=';
                    if (str.startsWith(prefix)) {
                        stateJson = str.substring(prefix.length);
                        if (stateJson.endsWith(';')) {
                            stateJson = stateJson.substring(0, stateJson.length - 1);
                        }
                        break;
                    }
                }
            }

            if (stateJson) {
                const state = JSON.parse(stateJson);

                const jobs = state.positionList || (state.searchResult && state.searchResult.positionList) || (state.jobList && state.jobList.list) || [];

                if (jobs.length > 0) {
                    jobs.forEach(job => {
                        const id = job.number || job.jobId || (job.position && job.position.base && job.position.base.positionId);
                        if (id) {
                            interceptedListJobs.set(String(id), job);
                        }
                    });
                    console.log(`[Zhilian Scraper] Extracted ${jobs.length} list jobs from __INITIAL_STATE__`);
                }

                const detail = state.jobDetail || state.positionDetail;
                if (detail) {
                    const detailedPosition = detail.detailedPosition || detail.position || detail;
                    const jobId = detailedPosition.number || detailedPosition.positionNumber || (detailedPosition.base && detailedPosition.base.positionNumber);
                    if (jobId) {
                        interceptedDetailJobs.set(String(jobId), detail);
                        console.log(`[Zhilian Scraper] Extracted detail for first job ${jobId} from __INITIAL_STATE__`);
                    }
                }
            }
        } catch (e) {
            console.error('[Zhilian Scraper] __INITIAL_STATE__ extraction failed', e);
        }
    }
    extractInitialState();

    function loadCache(callback) {
        chrome.storage.local.get(['zhilian_scraped_v2'], (res) => {
            scrapedData = Array.isArray(res.zhilian_scraped_v2) ? res.zhilian_scraped_v2 : [];
            scrapedIds = new Set(scrapedData.map(d => d['职位ID']).filter(Boolean));
            if (callback) callback();
        });
    }

    function saveCache(callback, newRow = null) {
        chrome.storage.local.set({ zhilian_scraped_v2: scrapedData }, () => {
            notifyPopupCount();
            if (callback) callback();
        });

        // 将新增或更新的数据推送到本地服务器进行测试
        if (newRow) {
            fetch('http://localhost:3000/api/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([newRow])
            }).catch(err => {
                // 如果本地服务器未开启，这里会忽略错误，不影响原有逻辑
                console.log('[zhilian Scraper] Local server sync failed (expected if not running):', err);
            });

            // https://job-dashboard-bgr.pages.dev (已注释)
            // fetch('https://job-dashboard-bgr.pages.dev/api/jobs', {
            //     method: 'POST',
            //     headers: { 'Content-Type': 'application/json' },
            //     body: JSON.stringify([newRow])
            // }).catch(err => {
            //     // 如果本地服务器未开启，这里会忽略错误，不影响原有逻辑
            //     console.log('[zhilian Scraper] Remote server sync failed (expected if not running):', err);
            // });
        }
    }

    function notifyPopupStatus(statusText) {
        chrome.runtime.sendMessage({
            action: 'zhilian_status_update',
            statusText: statusText,
            count: scrapedData.length
        });
    }

    function notifyPopupCount() {
        chrome.runtime.sendMessage({
            action: 'zhilian_status_update',
            statusText: isRunning ? '抓取中...' : '闲置',
            count: scrapedData.length
        });
    }

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'zhilian_start') {
                isAutoScroll = request.autoScroll !== false;
                skipScraped = request.skipScraped !== false;
                if (!isRunning) {
                    loadCache(() => {
                        startScraping();
                    });
                }
                sendResponse({ status: 'started' });
            } else if (request.action === 'zhilian_stop') {
                isRunning = false;
                clearTimeout(waitTimer);
                notifyPopupStatus('已暂停');
                sendResponse({ status: 'stopped' });
            } else if (request.action === 'zhilian_clear') {
                scrapedData = [];
                scrapedIds.clear();
                sessionProcessedIds.clear();
            } else if (request.action === 'zhilian_get_status') {
                sendResponse({ isRunning, status: isRunning ? '正在运行...' : '闲置' });
            } else if (request.action === 'zhilian_scrape_single') {
                loadCache(() => {
                    scrapeSinglePage();
                });
            }
        });
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data) return;
        if (event.data.type === 'ZHILIAN_JOB_LIST') {
            const data = event.data.data;
            const jobList = data?.data?.data?.list || data?.data?.list || data?.positionList || [];

            jobList.forEach(job => {
                const id = job.number || job.jobId || (job.position && job.position.base && job.position.base.positionId);
                if (id) {
                    interceptedListJobs.set(String(id), job);
                }
            });
        } else if (event.data.type === 'ZHILIAN_JOB_DETAIL') {
            const data = event.data.data;
            const jobInfo = data.data || data;
            const detailJobInfo = jobInfo.jobDetail || jobInfo.position || jobInfo;
            const jobId = cleanStr(detailJobInfo.number || detailJobInfo.positionNumber || (detailJobInfo.base && detailJobInfo.base.positionNumber));

            if (jobId) {
                interceptedDetailJobs.set(jobId, jobInfo);
            }

            if (isRunning) {
                onDetailApiCaptured(jobInfo);
            }
        }
    });

    function upsertData(jobId, row, callback) {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const todayStr = `${yyyy}-${mm}-${dd}`;

        const existingIndex = scrapedData.findIndex(d => (d.jobId || d['职位ID']) === jobId);
        if (existingIndex >= 0) {
            const oldRow = scrapedData[existingIndex];
            row['创建时间'] = oldRow['创建时间'] || todayStr;
            row['更新时间'] = todayStr;
            row['平台'] = 'zhilian';
            row.platform = 'zhilian';
            scrapedData[existingIndex] = row;
        } else {
            row['创建时间'] = todayStr;
            row['更新时间'] = todayStr;
            row['平台'] = 'zhilian';
            row.platform = 'zhilian';
            scrapedData.push(row);
        }
        scrapedIds.add(jobId);
        saveCache(callback, row);
    }

    function onDetailApiCaptured(json) {
        clearTimeout(waitTimer);

        const data = json || {};
        const job = data.jobDetail || data.position || data;
        const jobId = cleanStr(
            job.number ||
            job.positionNumber ||
            (job.base && job.base.positionNumber) ||
            (data.data && data.data.number) ||
            (data.detailedPosition && data.detailedPosition.positionNumber)
        );
        const finalJobId = jobId || (currentList[currentIndex] ? currentList[currentIndex].jobId : null);

        if (!finalJobId) {
            scheduleNextJob();
            return;
        }

        let row;
        if (interceptedListJobs.has(finalJobId)) {
            row = JSON.parse(JSON.stringify(interceptedListJobs.get(finalJobId)));
            row.jobDetail = json;
        } else {
            row = { ...json };
        }

        row.jobId = finalJobId;
        row.platform = 'zhilian';
        row.dataSource = 'zhilian_scraped_v2';
        row['平台'] = 'zhilian';
        row['数据来源'] = 'zhilian_scraped_v2';
        row['职位ID'] = finalJobId;

        // Basic fields mapping for easier viewing in UI
        row['职位名称'] = row.name ||
            (row.position && row.position.base && row.position.base.positionName) ||
            (row.jobDetail && row.jobDetail.position && row.jobDetail.position.base && row.jobDetail.position.base.positionName) ||
            (row.detailedPosition && row.detailedPosition.positionName) || '';

        row['公司全称'] = row.companyName ||
            (row.jobDetail && row.jobDetail.company && row.jobDetail.company.name) ||
            (row.detailedCompany && row.detailedCompany.companyName) || '';

        upsertData(finalJobId, row, () => {
            console.log(`✅ [已更新 ${scrapedData.length}] ${finalJobId} | ${row['职位名称']}`);
            scheduleNextJob();
        });
    }

    function scrapeSinglePage() {
        try {
            const m = location.href.match(/\/jobdetail\/([^.?#]+)\.htm/);
            const jobId = m ? m[1] : `ID_${Date.now()}`;

            let initialState = null;
            const scripts = document.querySelectorAll('script');
            for (let s of scripts) {
                const text = s.innerHTML || s.textContent || '';
                const prefix = '__INITIAL_STATE__=';
                if (text.includes(prefix)) {
                    const startIndex = text.indexOf(prefix);
                    let jsonStr = text.substring(startIndex + prefix.length);
                    jsonStr = jsonStr.trim();
                    if (jsonStr.endsWith(';')) {
                        jsonStr = jsonStr.substring(0, jsonStr.length - 1);
                    }
                    try {
                        initialState = JSON.parse(jsonStr);
                    } catch (e) {
                        console.error('[Zhilian Scraper] Parse __INITIAL_STATE__ error in scrapeSinglePage:', e);
                    }
                    break;
                }
            }

            const row = {
                '职位ID': jobId,
                '平台': 'zhilian',
                '数据来源': 'zhilian_scraped_v2', // 统一使用新版处理逻辑
                'platform': 'zhilian',
                'dataSource': 'zhilian_scraped_v2',
                '抓取时间': new Date().toLocaleString()
            };

            if (initialState) {
                if (initialState.jobDetail) {
                    row.jobDetail = initialState.jobDetail;
                } else {
                    Object.assign(row, initialState);
                }

                chrome.storage.local.get([
                    'zhilian_single_details',
                    'zhilian_enrichment_cache',
                    'zhilian_company_cache'
                ], (res) => {
                    // 1. 保存职位详情
                    const list = res.zhilian_single_details || [];
                    const idx = list.findIndex(item => item['职位ID'] === jobId);
                    if (idx >= 0) {
                        list[idx] = row;
                    } else {
                        list.push(row);
                    }

                    let cache = res.zhilian_enrichment_cache || {};
                    let companyCache = res.zhilian_company_cache || {};
                    let cacheUpdated = false;
                    let companyCacheUpdated = false;

                    // 2. 保存推荐职位到影子库
                    if (initialState.jobDeliverList && Array.isArray(initialState.jobDeliverList)) {
                        initialState.jobDeliverList.forEach(jobItem => {
                            const recJobId = jobItem.number || jobItem.positionNumber;
                            if (recJobId) {
                                cache[recJobId] = jobItem;
                                cacheUpdated = true;
                            }
                        });
                        console.log(`[Zhilian Scraper] 已提取 ${initialState.jobDeliverList.length} 个推荐职位至影子库`);
                    }

                    // 3. 保存公司详情到影子库
                    if (initialState.companyExtDetail) {
                        const comp = (initialState.jobDetail && initialState.jobDetail.detailedCompany) || {};
                        const compNumber = comp.companyNumber || '';
                        const compUrl = comp.url || '';
                        if (compNumber) {
                            companyCache[compNumber] = Object.assign({}, initialState.companyExtDetail, {
                                companyNumber: compNumber,
                                url: compUrl
                            });
                            companyCacheUpdated = true;
                        }
                    }

                    let toSet = {
                        'zhilian_single_details': list
                    };
                    if (cacheUpdated) toSet.zhilian_enrichment_cache = cache;
                    if (companyCacheUpdated) toSet.zhilian_company_cache = companyCache;

                    chrome.storage.local.set(toSet, () => {
                        showToast('✅ 职位详情、推荐列表及公司信息已分别更新至缓存！');

                        // 同步职位详情到本地服务器
                        fetch('http://localhost:3000/api/job-details', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify([row])
                        }).catch(err => {
                            console.log('[Zhilian Scraper] Local server job detail sync failed:', err);
                        });
                        // 同步职位详情到远程服务器 (已注释)
                        // fetch('https://job-dashboard-bgr.pages.dev/api/job-details', {
                        //     method: 'POST',
                        //     headers: { 'Content-Type': 'application/json' },
                        //     body: JSON.stringify([row])
                        // }).catch(err => {
                        //     console.log('[Zhilian Scraper] Remote server job detail sync failed (expected if not running):', err);
                        // });

                        // 同步影子数据库到本地项目
                        if (cacheUpdated) {
                            fetch('http://localhost:3000/api/zhilian-cache', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(cache)
                            }).catch(err => {
                                console.log('[Zhilian Scraper] Local server cache sync failed:', err);
                            });
                        }
                        // 同步影子数据库到远程 服务器 (已注释)
                        // if (cacheUpdated) {
                        //     fetch('https://job-dashboard-bgr.pages.dev/api/zhilian-cache', {
                        //         method: 'POST',
                        //         headers: { 'Content-Type': 'application/json' },
                        //         body: JSON.stringify(cache)
                        //     }).catch(err => {
                        //         console.log('[Zhilian Scraper] Local server cache sync failed:', err);
                        //     });
                        // }

                        // 同步公司详情到本地及远程服务器
                        if (companyCacheUpdated) {
                            const comp = (initialState.jobDetail && initialState.jobDetail.detailedCompany) || {};
                            const compNumber = comp.companyNumber || '';
                            if (compNumber) {
                                const companyToSync = {
                                    ...companyCache[compNumber],
                                    companyName: comp.companyName,
                                    platform: 'zhilian',
                                    dataSource: 'zhilian_company_cache',
                                    '平台': 'zhilian',
                                    '数据来源': 'zhilian_company_cache'
                                };
                                // 同步到本地服务器
                                fetch('http://localhost:3000/api/companies', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify([companyToSync])
                                    }).catch(err => {
                                    console.log('[Zhilian Scraper] Local server company sync failed:', err);
                                });
                                // 同步到远程服务器 (已注释)
                                // fetch('https://job-dashboard-bgr.pages.dev/api/companies', {
                                //     method: 'POST',
                                //     headers: { 'Content-Type': 'application/json' },
                                //     body: JSON.stringify([companyToSync])
                                // }).catch(err => {
                                //     console.log('[Zhilian Scraper] Remote server company sync failed:', err);
                                // });
                            }
                        }
                    });
                });

            } else {
                console.warn('[Zhilian Scraper] 未在详情页找到 __INITIAL_STATE__');
            }

        } catch (err) {
            console.error('[Zhilian Scraper] 抓取详情页时报错:', err);
            showToast('❌ 抓取报错: ' + err.message);
        }
    }

    function showToast(msg) {
        const div = document.createElement('div');
        div.textContent = msg;
        div.style.cssText = `
            position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
            background: #00c2b3; color: white; padding: 12px 24px;
            border-radius: 8px; z-index: 9999999; font-size: 15px; font-weight: bold; pointer-events: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2); transition: opacity 0.5s;
        `;
        document.body.appendChild(div);
        setTimeout(() => {
            div.style.opacity = '0';
            setTimeout(() => div.remove(), 500);
        }, 3000);
    }

    function collectJobsFromDOM() {
        const seen = new Set();
        const list = [];

        // 1. 优先获取主列表内的职位卡片，保证从上到下的顺序
        const allCards = document.querySelectorAll('.job-list-panel .job-card, .job-card, .position-list-item, [class*="joblist-box"]');

        if (allCards.length > 0) {
            allCards.forEach(card => {
                // 排除隐藏的卡片 (通过判断 offset 属性过滤)
                if (!(card.offsetWidth || card.offsetHeight || card.getClientRects().length)) return;

                let targetLink = card.querySelector('a');
                let jobId = null;

                // 尝试从卡片内的所有链接提取 jobId
                const links = card.querySelectorAll('a');
                for (let link of links) {
                    const href = link.getAttribute('href') || link.dataset.savedHref || '';
                    const m = href.match(/(CCL\d+J\d+)|(CC\d+J\d+)/) || href.match(/\/jobdetail\/([^.?#]+)/);
                    if (m) {
                        jobId = m[1] || m[2] || m[3];
                        targetLink = link;
                        break;
                    }
                }

                // 高度鲁棒回退策略: 如果没有从链接找到ID，通过标题匹配从已拦截的列表中绑定到卡片
                if (!jobId && interceptedListJobs.size > 0) {
                    const elText = card.innerText ? card.innerText.replace(/\s+/g, '') : '';
                    for (let [id, job] of interceptedListJobs.entries()) {
                        if (seen.has(id)) continue;

                        const title = job.name || job.jobName || (job.position && job.position.base && job.position.base.positionName);
                        const company = job.companyName || (job.company && job.company.name) || '';
                        if (!title) continue;

                        const cleanTitle = title.replace(/\s+/g, '');
                        const cleanCompany = company.replace(/\s+/g, '');

                        if (elText.includes(cleanTitle) && (!cleanCompany || elText.includes(cleanCompany))) {
                            jobId = id;
                            break;
                        }
                    }
                }

                if (jobId && !seen.has(jobId)) {
                    seen.add(jobId);
                    list.push({ jobId, el: card, link: targetLink || card });
                }
            });
        } else {
            // 如果没找到卡片容器，降级回全局查找 a 标签
            document.querySelectorAll('a').forEach(link => {
                // 排除隐藏的链接
                if (!(link.offsetWidth || link.offsetHeight || link.getClientRects().length)) return;

                const href = link.getAttribute('href') || link.dataset.savedHref || '';
                const m = href.match(/(CCL\d+J\d+)|(CC\d+J\d+)/) || href.match(/\/jobdetail\/([^.?#]+)/);
                const jobId = m ? (m[1] || m[2] || m[3]) : null;
                if (jobId && !seen.has(jobId)) {
                    seen.add(jobId);
                    let el = link.closest('[class*="item"], [class*="card"], [class*="box"]') || link;
                    list.push({ jobId, el: el, link: link });
                }
            });
        }

        return list;
    }

    function isJobUnprocessed(jobId) {
        const idStr = String(jobId);
        if (sessionProcessedIds.has(idStr)) return false;
        if (skipScraped && scrapedIdsCache.has(idStr)) return false;
        return true;
    }

    function startScraping() {
        const allJobs = collectJobsFromDOM();
        if (allJobs.length === 0) {
            alert('未发现职位卡片！请先搜索职位，等列表加载完毕后再开始。');
            isRunning = false;
            notifyPopupStatus('出错: 未发现职位卡片');
            return;
        }

        scrapedIdsCache = new Set(scrapedData.map(d => String(d['职位ID'])));
        currentList = allJobs.filter(j => isJobUnprocessed(j.jobId));
        currentIndex = 0;
        isRunning = true;

        if (currentList.length === 0) {
            if (isAutoScroll) { loadMoreByScroll(); }
            else {
                alert('当前所有可见职位已被过滤（或已抓取完毕）！');
                isRunning = false;
                notifyPopupStatus('完毕');
            }
            return;
        }

        processNext();
    }

    function processNext() {
        if (!isRunning) return;

        if (currentIndex >= currentList.length) {
            if (isAutoScroll) { loadMoreByScroll(); }
            else { alert('🎉 本批职位全部抓完！'); isRunning = false; notifyPopupStatus('完毕'); }
            return;
        }

        const job = currentList[currentIndex];
        sessionProcessedIds.add(job.jobId);
        notifyPopupStatus(`正在点击第 ${currentIndex + 1}/${currentList.length}`);

        try {
            job.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (e) { }

        setTimeout(() => {
            const cachedDetail = interceptedDetailJobs.get(job.jobId);

            if (cachedDetail) {
                onDetailApiCaptured(cachedDetail);
            } else {
                const simulateClick = (element) => {
                    if (!element) return;
                    try {
                        const event = new MouseEvent('click', {
                            view: window,
                            bubbles: true,
                            cancelable: true,
                            buttons: 1
                        });
                        element.dispatchEvent(event);
                    } catch (e) {
                        try { element.click(); } catch (err) { }
                    }
                };

                try {
                    const innerText = job.el.querySelector('.job-card__name, .job-card__title-main');
                    simulateClick(innerText || job.el);
                } catch (e) { }

                waitTimer = setTimeout(() => {
                    try { simulateClick(job.el); } catch (e) { }
                    waitTimer = setTimeout(() => {
                        console.warn(`[Zhilian] Detail API not captured for ${job.jobId}, skipping.`);
                        scheduleNextJob();
                    }, 4000);
                }, 2000);
            }
        }, getRandomInt(400, 900));
    }

    function scheduleNextJob() {
        if (!isRunning) return;
        currentIndex++;
        jobsScrapedSinceRest++;

        if (currentIndex >= currentList.length) {
            if (isAutoScroll) { setTimeout(loadMoreByScroll, 1500); }
            else { alert('🎉 本批职位全部抓完！'); isRunning = false; notifyPopupStatus('完毕'); }
            return;
        }

        const delay = getRandomInt(1500, 3500);
        notifyPopupStatus(`安全休眠 ${(delay / 1000).toFixed(1)}s`);
        setTimeout(() => {
            processNext();
        }, delay);
    }

    function loadMoreByScroll() {
        notifyPopupStatus(`等待新数据加载...`);

        let attempts = 0;
        const poll = setInterval(() => {
            attempts++;

            window.scrollBy({ top: 300, behavior: 'smooth' });
            const nextBtn = Array.from(document.querySelectorAll('button, a')).find(el =>
                el.innerText && el.innerText.trim() === '下一页' &&
                !el.disabled &&
                !el.classList.contains('soupager__btn--disable') &&
                !el.classList.contains('disabled') &&
                !el.classList.contains('is-disabled') &&
                !el.classList.contains('ant-pagination-disabled')
            );

            if (attempts === 1 && nextBtn) {
                nextBtn.click();
            }

            scrapedIdsCache = new Set(scrapedData.map(d => String(d['职位ID'])));
            const newJobs = collectJobsFromDOM().filter(j => isJobUnprocessed(j.jobId));
            if (newJobs.length > 0) {
                clearInterval(poll);
                const wait = getRandomInt(2000, 3500);
                notifyPopupStatus(`等待新卡片渲染 (${(wait / 1000).toFixed(1)}s)`);
                setTimeout(() => { if (isRunning) startScraping(); }, wait);
            } else if (attempts >= 24) {
                clearInterval(poll);
                alert(`🎉 抓取完毕！已滚动至列表末尾，共缓存 ${scrapedData.length} 条数据。`);
                isRunning = false;
                notifyPopupStatus('完毕');
            }
        }, 500);
    }

    if (location.href.includes('/jobdetail/')) {
        setTimeout(() => {
            const m = location.href.match(/\/jobdetail\/([^.?#]+)\.htm/);
            const jobId = m ? m[1] : null;

            scrapeSinglePage();

            if (location.href.includes('auto_close=1')) {
                setTimeout(() => {
                    window.close();
                    try {
                        chrome.runtime.sendMessage({ action: 'close_current_tab' });
                    } catch (e) { }
                }, 5000);
            }
        }, 2000);
    }
})();
