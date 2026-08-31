(function () {
    'use strict';

    // ==========================================
    // LIEPIN HOME ISOLATED WORLD LOGIC (Master Mode for c.liepin.com)
    // ==========================================

    let isRunning = false;
    let isAutoPage = true;
    let openMode = 'iframe';
    let skipScraped = true;
    let globalJobQueue = [];
    let domCardQueue = [];
    let currentCardIndex = 0;

    let scrapedData = [];
    let scrapedIds = new Set();
    let sessionProcessedIds = new Set();
    let activeIframe = null;
    let jobsScrapedSinceRest = 0;

    let scrapedCompanies = [];
    let scrapedCompIds = new Set();

    function getRandomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    // 与 Background 通信 (读写数据)
    function loadCache(callback) {
        chrome.storage.local.get(['liepin_scraped_data_v1', 'liepin_companies_db_v1'], (result) => {
            if (result && result['liepin_scraped_data_v1']) {
                scrapedData = result['liepin_scraped_data_v1'];
                scrapedIds = new Set(scrapedData.map(d => String(d['职位ID'])));
            } else {
                scrapedData = [];
                scrapedIds = new Set();
            }
            if (result && result['liepin_companies_db_v1']) {
                scrapedCompanies = result['liepin_companies_db_v1'];
                scrapedCompIds = new Set(scrapedCompanies.map(c => String(c.compId)));
            } else {
                scrapedCompanies = [];
                scrapedCompIds = new Set();
            }
            if (callback) callback();
        });
    }

    function saveCache(callback, newRow = null) {
        chrome.storage.local.set({ 'liepin_scraped_data_v1': scrapedData }, () => {
            notifyPopupStatus('已保存');
            if (callback) callback();
        });

        if (newRow) {
            newRow['平台'] = 'liepin';
            newRow['数据来源'] = 'liepin_home_data';
            newRow.platform = 'liepin';
            newRow.dataSource = 'liepin_home_data';

            fetch('http://localhost:3000/api/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([newRow])
            }).catch(err => {
                console.log('[Liepin Scraper] Local server sync failed (expected if not running):', err);
            });

            // https://job-dashboard-bgr.pages.dev (已注释)
            // fetch('https://job-dashboard-bgr.pages.dev/api/jobs', {
            //     method: 'POST',
            //     headers: { 'Content-Type': 'application/json' },
            //     body: JSON.stringify([newRow])
            // }).catch(err => {
            //     // 如果远程服务器未开启，这里会忽略错误，不影响原有逻辑
            //     console.log('[Liepin Scraper] Remote server sync failed (expected if not running):', err);
            // });
        }
    }

    function notifyPopupStatus(statusText) {
        chrome.runtime.sendMessage({
            action: 'liepin_update_status',
            status: statusText
        });
        chrome.runtime.sendMessage({
            action: 'liepin_update_count',
            count: scrapedData.length
        });
    }

    function upsertCompanies(comps) {
        if (!comps || comps.length === 0) return;
        let changed = false;
        let newlyAdded = [];
        comps.forEach(c => {
            if (!scrapedCompIds.has(String(c.compId))) {
                scrapedCompanies.push(c);
                scrapedCompIds.add(String(c.compId));

                const cToSync = {
                    ...c,
                    platform: 'liepin',
                    dataSource: 'liepin_companies_db_v1',
                    '平台': 'liepin',
                    '数据来源': 'liepin_companies_db_v1'
                };
                newlyAdded.push(cToSync);
                changed = true;
            }
        });
        if (changed) {
            chrome.storage.local.set({ 'liepin_companies_db_v1': scrapedCompanies });

            fetch('http://localhost:3000/api/companies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newlyAdded)
            }).catch(err => {
                console.log('[Liepin Scraper] Local server company sync failed:', err);
            });

            // https://job-dashboard-bgr.pages.dev (已注释)
            // fetch('https://job-dashboard-bgr.pages.dev/api/companies', {
            //     method: 'POST',
            //     headers: { 'Content-Type': 'application/json' },
            //     body: JSON.stringify(newlyAdded)
            // }).catch(err => {
            //     console.log('[Liepin Scraper] Remote server sync failed (expected if not running):', err);
            // });
        }
    }

    function upsertData(jobId, row, callback) {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const todayStr = `${yyyy}-${mm}-${dd}`;

        const existingIndex = scrapedData.findIndex(d => String(d['职位ID']) === String(jobId));
        if (existingIndex >= 0) {
            const oldRow = scrapedData[existingIndex];
            row['创建时间'] = oldRow['创建时间'] || todayStr;
            row['更新时间'] = todayStr;
            row['平台'] = 'liepin';
            row.platform = 'liepin';
            scrapedData[existingIndex] = row;
        } else {
            row['创建时间'] = todayStr;
            row['更新时间'] = todayStr;
            row['平台'] = 'liepin';
            row.platform = 'liepin';
            scrapedData.push(row);
        }
        scrapedIds.add(String(jobId));
        saveCache(callback, row);
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'liepin_start') {
            if (window !== window.top) return;
            isAutoPage = request.autoScroll;
            if (request.openMode) {
                openMode = request.openMode;
            }
            if (request.skipScraped !== undefined) {
                skipScraped = request.skipScraped;
            }
            sessionProcessedIds.clear();
            if (!isRunning) {
                loadCache(() => {
                    startScraping();
                });
            }
        } else if (request.action === 'liepin_stop') {
            isRunning = false;
            if (activeIframe) {
                activeIframe.src = 'about:blank';
                activeIframe.remove();
                activeIframe = null;
            }
            if (window.__CURRENT_IFRAME_TIMEOUT__) {
                clearTimeout(window.__CURRENT_IFRAME_TIMEOUT__);
                window.__CURRENT_IFRAME_TIMEOUT__ = null;
            }
            notifyPopupStatus('已暂停');
        } else if (request.action === 'liepin_clear') {
            scrapedData = [];
            scrapedIds.clear();
            sessionProcessedIds.clear();
            scrapedCompanies = [];
            scrapedCompIds.clear();
            chrome.storage.local.set({ 'liepin_companies_db_v1': [] });
            saveCache();
        } else if (request.action === 'liepin_get_status') {
            sendResponse({ isRunning, status: isRunning ? '正在运行...' : '闲置' });
        } else if (request.action === 'LIEPIN_DATA_RETURNED' && request.data) {
            window.postMessage(request.data, '*');
        }
    });

    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'LIEPIN_LIST_DATA') {
            const newList = event.data.data || [];
            let added = 0;
            for (let j of newList) {
                if (!sessionProcessedIds.has(j.job?.jobId)) {
                    globalJobQueue.push(j);
                    sessionProcessedIds.add(j.job?.jobId);
                    added++;
                }
            }
            console.log(`📥 [首页隔离层] 接收到猎聘列表数据: ${newList.length} 条，新增入队 ${added} 条，当前队列总计 ${globalJobQueue.length} 条`);
        } else if (event.data && event.data.type === 'LIEPIN_DETAIL_DATA') {
            handleDetailData(event.data.jobId, event.data.detailJson, event.data.hotCompanies);
        } else if (event.data && event.data.type === 'LIEPIN_DETAIL_DATA_ERROR') {
            handleDetailDataError(event.data.jobId, event.data.error);
        }
    });

    function startScraping() {
        const cards = Array.from(document.querySelectorAll('[data-tlg-elem-id="c_pc_search_job_listcard"], .job-list-item, [class*="job-card-pc-container"], .job-card-wrap, [class*="job-card"]'));
        let missingJsonCount = 0;
        let newCardsCount = 0;

        for (let c of cards) {
            // 过滤掉页面上隐藏的无效/下线职位卡片 (display: none)
            if (c.offsetWidth === 0 && c.offsetHeight === 0) {
                continue;
            }

            let jobId = null;
            const a = c.querySelector('a[href*="/job/"], a[href*="/a/"]');
            if (a) {
                const match = a.href.match(/\/(?:job|a)\/([a-zA-Z0-9_]+)\.shtml/);
                if (match) jobId = match[1];
            }
            if (!jobId && c.tagName.toLowerCase() === 'a') {
                const match = c.href.match(/\/(?:job|a)\/([a-zA-Z0-9_]+)\.shtml/);
                if (match) jobId = match[1];
            }
            if (!jobId) {
                const scm = c.getAttribute('data-tlg-scm');
                if (scm && scm.includes('cid=1_')) {
                    const m = scm.match(/cid=1_([a-zA-Z0-9_]+)/);
                    if (m) jobId = m[1];
                }
            }
            if (!jobId) {
                const href = c.getAttribute('href') || (c.querySelector('a') ? c.querySelector('a').getAttribute('href') : null);
                if (href) {
                     const match = href.match(/\/(?:job|a)\/([a-zA-Z0-9_]+)\.shtml/);
                     if (match) jobId = match[1];
                }
            }
            
            if (jobId && !domCardQueue.find(x => x.jobId === jobId)) {
                const jsonItem = globalJobQueue.find(j => {
                    let jsonJobId = j.job?.jobId;
                    if (j.job?.link) {
                        const m = j.job.link.match(/\/(?:job|a)\/([a-zA-Z0-9_]+)\.shtml/);
                        if (m) jsonJobId = m[1];
                    }
                    return String(jsonJobId) === String(jobId);
                });
                domCardQueue.push({ card: c, jobId: jobId, jsonItem: jsonItem });
                newCardsCount++;
                if (!jsonItem) {
                    missingJsonCount++;
                }
            }
        }

        if (domCardQueue.length === 0) {
            if (globalJobQueue.length > 0) {
                 console.warn('[回退机制] 未在页面上找到职位卡片，回退到按 JSON 队列执行。');
                 domCardQueue = globalJobQueue.map(item => {
                     let fallbackId = item.job?.jobId;
                     if (item.job?.link) {
                         const m = item.job.link.match(/\/(?:job|a)\/([a-zA-Z0-9_]+)\.shtml/);
                         if (m) fallbackId = m[1];
                     }
                     return {
                         jobId: String(fallbackId),
                         card: null,
                         jsonItem: item
                     };
                 });
            } else {
                 alert('未发现猎聘职位数据！请先进行职位搜索或滚动页面加载数据。');
                 isRunning = false;
                 notifyPopupStatus('出错: 无数据');
                 return;
            }
        }

        console.log(`[DOM扫描] 页面共找到 ${domCardQueue.length} 个可见职位卡片 (本次新增 ${newCardsCount} 个)，其中 ${missingJsonCount} 个缺失JSON数据。`);

        isRunning = true;
        processNext();
    }

    function processNext() {
        if (!isRunning) return;

        if (performance && performance.memory) {
            const memoryLimit = performance.memory.jsHeapSizeLimit;
            const memoryUsed = performance.memory.usedJSHeapSize;
            const usageRatio = memoryUsed / memoryLimit;
            console.log(`[内存监控] 已用: ${(memoryUsed / 1048576).toFixed(1)}MB / 上限: ${(memoryLimit / 1048576).toFixed(1)}MB (${(usageRatio * 100).toFixed(1)}%)`);

            if (usageRatio > 0.85) {
                console.log(`⚠️ 浏览器内存占用过高，即将崩溃！(${usageRatio * 100}%)。正在保存进度并自动刷新页面...`);
                isRunning = false;
                notifyPopupStatus('内存极高，自动刷新重载...');
                if (activeIframe) { activeIframe.src = "about:blank"; activeIframe.remove(); activeIframe = null; }

                chrome.storage.local.set({ 'liepin_auto_resume_v1': { autoScroll: isAutoPage } }, () => {
                    location.reload();
                });
                return;
            }
        }

        if (currentCardIndex >= domCardQueue.length) {
            if (activeIframe) { activeIframe.src = "about:blank"; activeIframe.remove(); activeIframe = null; }
            if (isAutoPage) {
                goToNextPage();
            } else {
                alert('🎉 当前可见职位抓取完毕！');
                isRunning = false;
                notifyPopupStatus('完毕');
            }
            return;
        }

        const currentJobData = domCardQueue[currentCardIndex];
        currentCardIndex++;

        const jobId = currentJobData.jobId;
        const targetCard = currentJobData.card;
        const jsonItem = currentJobData.jsonItem;

        if (!jsonItem) {
            console.log(`⚠️ [跳过] 职位卡片 ${jobId} 未在拦截的JSON队列中找到匹配数据，跳过。`);
            if (targetCard) {
                targetCard.style.boxShadow = '0 0 20px rgba(128, 128, 128, 0.8)';
                targetCard.style.border = '2px solid gray';
            }
            notifyPopupStatus(`跳过无数据卡片 ${currentCardIndex}/${domCardQueue.length}`);
            scheduleNextJob(true);
            return;
        }

        const job = jsonItem.job || {};

        if (skipScraped && scrapedIds.has(String(job.jobId))) {
            console.log(`[查重跳过] 职位 ${job.jobId} 已经存在本地缓存中。`);
            notifyPopupStatus(`跳过已存在职位 ${currentCardIndex}/${domCardQueue.length}`);
            scheduleNextJob(true);
            return;
        }
        notifyPopupStatus(`正在抓取 ${currentCardIndex}/${domCardQueue.length}`);

        const row = {
            ...jsonItem,
            '平台': 'Liepin',
            '职位ID': job.jobId
        };

        if (targetCard) {
            window.__CURRENT_TARGET_CARD__ = targetCard;
            targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetCard.style.transition = 'all 0.3s ease';
            targetCard.style.boxShadow = '0 0 20px rgba(255, 0, 0, 0.8)';
            targetCard.style.border = '2px solid red';
            targetCard.style.transform = 'scale(1.02)';
        }

        const detailUrl = job.link ? job.link.split('?')[0] : `https://www.liepin.com/job/${job.jobId}.shtml`;

        /* 
        // 禁用猎聘的新标签页模式：
        // 猎聘网使用了基于 visibilityState 的防爬与懒加载机制。当通过打开新标签页（在后台未激活）的方式访问详情页时，
        // 猎聘的 JavaScript 会挂起，拒绝渲染职位描述 DOM 节点。导致我们的提取脚本会空等 15-25 秒最终报错失败。
        // 仅有 iframe 模式由于是嵌在当前活动页面的前台中，可以避开此懒加载限制，因此强制使用 iframe。
        if (openMode === 'new_tab') {
            chrome.runtime.sendMessage({ action: 'LIEPIN_OPEN_TAB', url: detailUrl });
            if (activeIframe) { activeIframe.src = 'about:blank'; activeIframe.remove(); activeIframe = null; }
        } else {
        */
            if (activeIframe) { activeIframe.src = 'about:blank'; activeIframe.remove(); }
            activeIframe = document.createElement('iframe');
            activeIframe.style.cssText = 'position: fixed; right: 20px; bottom: 20px; width: 600px; height: 500px; z-index: 99999999; border: 3px solid #ff9800; background: white; box-shadow: 0 0 15px rgba(0,0,0,0.3); border-radius: 8px;';
            activeIframe.src = detailUrl;
            document.body.appendChild(activeIframe);
        // }

        window.__CURRENT_PROCESSING_ROW__ = row;

        window.__CURRENT_IFRAME_TIMEOUT__ = setTimeout(() => {
            console.warn(`[超时报警] 职位 ${job.jobId} 提取失败，可能已停止招聘或触发反爬。`);
            handleDetailDataError(job.jobId);
        }, 25000);
    }

    function handleDetailData(jobId, detailJson, hotCompanies) {
        if (window.__CURRENT_IFRAME_TIMEOUT__) {
            clearTimeout(window.__CURRENT_IFRAME_TIMEOUT__);
            window.__CURRENT_IFRAME_TIMEOUT__ = null;
        }

        const row = window.__CURRENT_PROCESSING_ROW__ || {};
        const comp = row.comp || {};
        let compsToSave = hotCompanies || [];

        let mainCompId = comp.compId;
        let mainCompLink = comp.link || '';
        let mainCompName = comp.fullCompanyName || comp.compName || '';

        if (!mainCompId && detailJson && detailJson.hiringOrganization && detailJson.hiringOrganization.sameAs) {
            mainCompLink = detailJson.hiringOrganization.sameAs;
            const match = mainCompLink.match(/\/company\/(\d+)\/?/);
            if (match) mainCompId = match[1];
            if (!mainCompName) mainCompName = detailJson.hiringOrganization.name;
        }

        if (mainCompId && mainCompName) {
            if (!mainCompLink) mainCompLink = `https://www.liepin.com/company/${mainCompId}/`;
            compsToSave.push({
                compId: String(mainCompId),
                compLink: mainCompLink,
                compName: mainCompName
            });
        }

        if (compsToSave.length > 0) {
            upsertCompanies(compsToSave);
        }

        row.jobDetailJson = detailJson;

        if (window.__CURRENT_TARGET_CARD__) {
            window.__CURRENT_TARGET_CARD__.style.boxShadow = '0 0 20px rgba(0, 255, 0, 0.8)';
            window.__CURRENT_TARGET_CARD__.style.border = '2px solid green';
        }

        upsertData(row['职位ID'], row, () => {
            console.log(`✅ [猎聘首页已抓取] ${row['职位名称']} (含深层描述)`);
            scheduleNextJob();
        });
    }

    function handleDetailDataError(jobId, errorReason) {
        if (!isRunning) return;

        if (errorReason === "BLOCKED_BY_CAPTCHA") {
            console.error(`🚨 [安全拦截] 职位 ${jobId} 触发了短信验证码安全拦截！`);
            alert("⚠️ 触发了猎聘的安全拦截（需要短信验证）！\n\n扩展程序已自动停止抓取以保护账号。请在当前页面或者新标签页中手动完成验证后，再重新开始抓取。");
            isRunning = false;
            if (activeIframe) { activeIframe.src = "about:blank"; activeIframe.remove(); activeIframe = null; }
            if (window.__CURRENT_IFRAME_TIMEOUT__) {
                clearTimeout(window.__CURRENT_IFRAME_TIMEOUT__);
                window.__CURRENT_IFRAME_TIMEOUT__ = null;
            }
            if (window.__CURRENT_TARGET_CARD__) {
                window.__CURRENT_TARGET_CARD__.style.boxShadow = '0 0 20px rgba(255, 0, 0, 0.8)';
                window.__CURRENT_TARGET_CARD__.style.border = '2px solid red';
            }
            notifyPopupStatus('被安全拦截');
            return;
        }

        if (errorReason === "OFFLINE") {
            console.warn(`⚠️ [猎聘跳过] 职位 ${jobId} 已暂停招聘或下线，直接跳过。`);
            if (activeIframe) { activeIframe.src = "about:blank"; activeIframe.remove(); activeIframe = null; }
            if (window.__CURRENT_IFRAME_TIMEOUT__) { clearTimeout(window.__CURRENT_IFRAME_TIMEOUT__); window.__CURRENT_IFRAME_TIMEOUT__ = null; }
            
            const row = window.__CURRENT_PROCESSING_ROW__ || {};
            row.jobDetailJson = { description: "该职位已暂停招聘或下线" };
            row['职位描述'] = "该职位已暂停招聘或下线";

            if (window.__CURRENT_TARGET_CARD__) {
                window.__CURRENT_TARGET_CARD__.style.boxShadow = '0 0 20px rgba(128, 128, 128, 0.8)';
                window.__CURRENT_TARGET_CARD__.style.border = '2px solid gray';
            }

            upsertData(row['职位ID'], row, () => {
                scheduleNextJob();
            });
            return;
        }

        if (window.__CURRENT_IFRAME_TIMEOUT__) {
            clearTimeout(window.__CURRENT_IFRAME_TIMEOUT__);
            window.__CURRENT_IFRAME_TIMEOUT__ = null;
        }
        console.warn(`[DOM提取失败] 职位 ${jobId} 提取失败，原因: ${errorReason || '超时没找到描述节点'}。`);

        if (activeIframe) {
            activeIframe.src = 'about:blank';
            activeIframe.remove();
            activeIframe = null;
        }

        // 停止抓取逻辑
        alert(`⚠️ 提取超时或遇到异常（职位 ${jobId}）。\n为了防止账号被封禁，扩展程序已自动停止抓取！请检查页面状态或手动重启。`);
        isRunning = false;

        if (window.__CURRENT_TARGET_CARD__) {
            window.__CURRENT_TARGET_CARD__.style.boxShadow = '0 0 20px rgba(128, 128, 128, 0.8)';
            window.__CURRENT_TARGET_CARD__.style.border = '2px solid gray';
        }

        notifyPopupStatus('已暂停(提取异常)');
        return;
    }

    function scheduleNextJob(isFast = false) {
        if (!isRunning) return;

        if (isFast) {
            setTimeout(processNext, 100);
            return;
        }

        jobsScrapedSinceRest++;

        let delay = getRandomInt(1000, 2000);
        if (jobsScrapedSinceRest >= 10 && Math.random() < 0.3) {
            delay += getRandomInt(3000, 5000);
            jobsScrapedSinceRest = 0;
            notifyPopupStatus(`防风控休眠 (${(delay / 1000).toFixed(1)}s)`);
        } else {
            notifyPopupStatus(`模拟阅读 (${(delay / 1000).toFixed(1)}s)`);
        }

        setTimeout(processNext, delay);
    }

    function goToNextPage() {
        notifyPopupStatus('向下滚动寻找更多数据...');
        const initialDomCount = document.querySelectorAll('[data-tlg-elem-id="c_pc_search_job_listcard"], .job-list-item, [class*="job-card-pc-container"], .job-card-wrap, [class*="job-card"]').length;
        let scrollAttempts = 0;
        const scrollInterval = setInterval(() => {
            if (!isRunning) {
                clearInterval(scrollInterval);
                return;
            }

            // 检查是否到底了
            const endNode = Array.from(document.querySelectorAll('div, span, p')).find(el => el.textContent.trim() === '到底啦~');
            if (endNode) {
                clearInterval(scrollInterval);
                alert('🎉 页面底部显示“到底啦~”，所有数据抓取完毕！');
                isRunning = false;
                notifyPopupStatus('全部抓取完毕');
                return;
            }

            const currentDomCount = document.querySelectorAll('[data-tlg-elem-id="c_pc_search_job_listcard"], .job-list-item, [class*="job-card-pc-container"], .job-card-wrap, [class*="job-card"]').length;
            
            if (currentDomCount > initialDomCount) {
                clearInterval(scrollInterval);
                // 延迟等待新渲染的卡片稳定及JSON数据收集完成
                setTimeout(() => {
                    if (isRunning) {
                        startScraping();
                    }
                }, 1500);
                return;
            }

            window.scrollBy({ top: 1500, behavior: 'smooth' });
            scrollAttempts++;

            if (scrollAttempts > 10) {
                clearInterval(scrollInterval);
                alert('🎉 连续多次滚动未发现新数据，可能是已到底部或网络超时。');
                isRunning = false;
                notifyPopupStatus('完毕或超时');
            }
        }, 3000);
    }

    if (window === window.top) {
        chrome.storage.local.get(['liepin_auto_resume_v1'], (result) => {
            if (result && result.liepin_auto_resume_v1) {
                const resumeData = result.liepin_auto_resume_v1;
                chrome.storage.local.remove('liepin_auto_resume_v1');
                console.log("🔄 [自动续传] 检测到因内存清理触发的刷新，3秒后自动恢复抓取...");
                setTimeout(() => {
                    isAutoPage = resumeData.autoScroll;
                    sessionProcessedIds.clear();
                    if (!isRunning) {
                        loadCache(() => {
                            startScraping();
                        });
                    }
                }, 3000);
            }
        });
    }
})();
