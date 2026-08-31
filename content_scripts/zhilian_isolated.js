/*
 * 智联招聘架构说明：
 * 智联招聘存在两种不同的页面渲染模式，因此需要两种抓取策略并存：
 *
 * 1. 客户端渲染 (CSR) - 例如: https://www.zhaopin.com/recommend
 *    特点: 页面通过 Ajax/Fetch 请求职位列表，接口直接返回饱含完整详情的 JSON 数据。
 *    策略: 使用 `zhilian_interceptor.js` 拦截 API，由本文件下半部分的“API拦截方案”直接扁平化保存至 `zhilian_scraped_data_v2`。
 *
 * 2. 服务端渲染 (SSR) - 例如: https://www.zhaopin.com/sou/xxx/xxx/p1 或 https://www.zhaopin.com/shanghai/Java/
 *    特点: 网页源代码中已包含完整的 HTML 结构（列表DOM），不会触发 Ajax 列表请求。
 *    策略: 使用本文件上半部分的“Master/Worker方案”（DOM遍历 + 后台开窗提取详情），依然保存至 `zhilian_scraped_data_v1` 或 `v2`。
 */

(function () {
    'use strict';

    // 区分当前页面是详情页还是列表页
    const isDetailPage = location.pathname.includes('/jobdetail/');

    // 判断是否是服务端渲染(SSR)的搜索列表页
    const isSsrSearchPage = location.pathname.includes('/sou/') ||
        (location.pathname.split('/').length >= 3 && !location.pathname.includes('/recommend') && !location.pathname.includes('/jobdetail/'));

    // ==========================================
    // 详情页模式 (后台标签页静默运行) - 适用于 SSR 方案的 Worker
    // ==========================================
    if (isDetailPage) {
        const targetUrl = localStorage.getItem('zhilian_scraper_target');
        let isScraper = false;

        if (targetUrl && (location.href.includes(targetUrl) || targetUrl.includes(location.pathname))) {
            isScraper = true;
            localStorage.removeItem('zhilian_scraper_target');
        }

        if (!isScraper) {
            console.log("👤 [智联] 用户手动打开详情页，不执行自动关闭/抓取。");
            return;
        }
        console.log("🕵️ [智联 Worker] 进入详情页模式");

        function extractDetailAndClose() {
            let initialState = null;
            const html = document.documentElement.innerHTML;

            // 尝试提取 __INITIAL_STATE__
            const match = html.match(/__INITIAL_STATE__\s*=\s*(\{.*?\});/s);
            if (match) {
                try {
                    initialState = JSON.parse(match[1]);
                } catch (e) { }
            } else {
                const startIdx = html.indexOf('__INITIAL_STATE__');
                if (startIdx !== -1) {
                    const objStart = html.indexOf('{', startIdx);
                    const scriptEnd = html.indexOf('</script>', objStart);
                    if (objStart !== -1 && scriptEnd !== -1) {
                        let jsonStr = html.substring(objStart, scriptEnd).trim();
                        jsonStr = jsonStr.replace(/;\s*$/, '');
                        try { initialState = JSON.parse(jsonStr); } catch (e) { }
                    }
                }
            }

            if (!initialState) {
                // 可能遇到风控滑块
                if (document.querySelector('.nc_wrapper, #captcha')) {
                    chrome.runtime.sendMessage({ action: 'ZHILIAN_DATA_EXTRACTED', data: 'BLOCKED' });
                    return; // 等待用户手动过验证，不要关闭
                }
                chrome.runtime.sendMessage({ action: 'ZHILIAN_DATA_EXTRACTED', data: 'TIMEOUT' });
                chrome.runtime.sendMessage({ action: 'ZHILIAN_CLOSE_TAB' });
                return;
            }

            let jobNumber = location.pathname.split('/').pop().replace('.htm', '');
            const jobDetailData = initialState.jobDetail || {};
            const pos = jobDetailData.detailedPosition || {};

            const detailData = {
                // 用于 Master 逻辑的核心控制字段
                '干净链接': location.href.split('?')[0],
                '职位ID': jobNumber,
                '职位名称': pos.positionName || pos.name || '',

                // 用户要求的原生结构
                jobDetail: initialState.jobDetail || {}
            };

            // 处理影子数据库逻辑 (异步)
            chrome.storage.local.get(['zhilian_enrichment_cache', 'zhilian_company_cache'], function (res) {
                let cache = res.zhilian_enrichment_cache || {};
                let companyCache = res.zhilian_company_cache || {};
                let cacheUpdated = false;
                let companyCacheUpdated = false;

                // 1. 将页面推荐岗位的泄漏数据存入影子数据库 (保存原始数据)
                if (initialState && initialState.jobDeliverList && Array.isArray(initialState.jobDeliverList)) {
                    initialState.jobDeliverList.forEach(recJob => {
                        if (recJob.number) {
                            cache[recJob.number] = recJob;
                            cacheUpdated = true;
                        }
                    });
                }

                // 2. 独立存储公司的信息（companyExtDetail）到另一个影子库
                if (initialState && initialState.companyExtDetail) {
                    const comp = (initialState.jobDetail && initialState.jobDetail.detailedCompany) || {};
                    const compNumber = comp.companyNumber || '';
                    const compUrl = comp.url || '';
                    if (compNumber) {
                        // 在 companyExtDetail 原数据中加入 companyNumber 和 url
                        companyCache[compNumber] = Object.assign({}, initialState.companyExtDetail, {
                            companyNumber: compNumber,
                            url: compUrl
                        });
                        companyCacheUpdated = true;
                    }
                }

                let toSet = {};
                if (cacheUpdated) {
                    toSet.zhilian_enrichment_cache = cache;
                    // 同步智联职位详情补全缓存到本地项目
                    fetch('http://localhost:3000/api/zhilian-cache', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(cache)
                    }).catch(err => {
                        console.log('[Zhilian Scraper] Local server cache sync failed:', err);
                    });

                    // https://job-dashboard-bgr.pages.dev (已注释)
                    // fetch('https://job-dashboard-bgr.pages.dev/api/zhilian-cache', {
                    //     method: 'POST',
                    //     headers: { 'Content-Type': 'application/json' },
                    //     body: JSON.stringify(cache)
                    // }).catch(err => {
                    //     // 如果远程服务器未开启，这里会忽略错误，不影响原有逻辑
                    //     console.log('[Zhilian Scraper] Remote server cache sync failed (expected if not running):', err);
                    // });
                }

                if (companyCacheUpdated) {
                    toSet.zhilian_company_cache = companyCache;

                    // 同步刚刚解析到的公司数据到本地项目
                    const comp = (initialState.jobDetail && initialState.jobDetail.detailedCompany) || {};
                    const compNumber = comp.companyNumber || '';
                    if (compNumber) {
                        const companyToSync = {
                            ...companyCache[compNumber],
                            companyName: comp.companyName, // 补齐公司名称，后端接口解析需要
                            platform: 'zhilian',
                            dataSource: 'zhilian_company_cache',
                            '平台': 'zhilian',
                            '数据来源': 'zhilian_company_cache'
                        };
                        fetch('http://localhost:3000/api/companies', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify([companyToSync])
                        }).catch(err => {
                            console.log('[Zhilian Scraper] Local server company sync failed:', err);
                        });

                        // https://job-dashboard-bgr.pages.dev (已注释)
                        // fetch('https://job-dashboard-bgr.pages.dev/api/companies', {
                        //     method: 'POST',
                        //     headers: { 'Content-Type': 'application/json' },
                        //     body: JSON.stringify([companyToSync])
                        // }).catch(err => {
                        //     // 如果远程服务器未开启，这里会忽略错误，不影响原有逻辑
                        //     console.log('[Zhilian Scraper] Remote server company sync failed (expected if not running):', err);
                        // });
                    }
                }

                if (Object.keys(toSet).length > 0) {
                    chrome.storage.local.set(toSet);
                }

                // 发送数据回主控制器，并关闭当前标签页
                chrome.runtime.sendMessage({ action: 'ZHILIAN_DATA_EXTRACTED', data: detailData });
                chrome.runtime.sendMessage({ action: 'ZHILIAN_CLOSE_TAB' });
            });
        }

        // 执行提取
        setTimeout(extractDetailAndClose, Math.random() * 1000 + 1000);
        return;
    }


    // ==========================================
    // Master 模式 (在 sou.zhaopin.com 列表页运行)
    // ==========================================
    const isMaster = window.self === window.top;
    if (!isMaster) return;

    console.log("🚀 [智联招聘] Master 脚本已加载 (后台开窗极速版架构)");

    let isRunning = false;
    let scrapedList = [];
    let currentIndex = 0;
    let allScrapedData = [];
    let sessionProcessedUrls = new Set();
    let currentSource = 'zhilian_scraped_data_v1';
    let currentWaitingItem = null;
    let waitTimer = null;

    function getRandomInt(min, max) { return Math.floor(Math.random() * (max - min)) + min; }
    function notifyPopupStatus(statusText) {
        chrome.runtime.sendMessage({
            action: 'zhilian_status_update',
            statusText: statusText,
            count: allScrapedData.length
        });
    }

    function saveData(data, newRow = null) {
        chrome.storage.local.set({ [currentSource]: data }, () => {
            if (chrome.runtime.lastError) {
                console.error("Storage Error:", chrome.runtime.lastError);
                notifyPopupStatus('⚠️ 缓存保存失败，存储容量可能已满或异常');
            }
        });

        if (newRow) {
            newRow['平台'] = 'zhilian';
            newRow['数据来源'] = currentSource;
            newRow.platform = 'zhilian';
            newRow.dataSource = currentSource;

            fetch('http://localhost:3000/api/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([newRow])
            }).then(r => r.json()).then(res => {
                if (res && res.changedJobs && res.changedJobs.length > 0) {
                    const c = res.changedJobs[0];
                    console.log(`%c[Job Monitor] ⚠️ 发现岗位变更: 【${c.companyName}】${c.title} -> ${c.reason || '内容更新'}`, 'color: #ea580c; font-weight: bold;');
                }
            }).catch(err => {
                console.log('[Zhilian Scraper] Local server sync failed:', err);
            });

            // https://job-dashboard-bgr.pages.dev (已注释)
            // fetch('https://job-dashboard-bgr.pages.dev/api/jobs', {
            //     method: 'POST',
            //     headers: { 'Content-Type': 'application/json' },
            //     body: JSON.stringify([newRow])
            // }).catch(err => {
            //     // 如果远程服务器未开启，这里会忽略错误，不影响原有逻辑
            //     console.log('[Zhilian Scraper] Remote server sync failed (expected if not running):', err);
            // });
        }
    }

    // 监听来自后台标签页返回的数据
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'ZHILIAN_DATA_RETURNED' && currentWaitingItem && isRunning) {
            clearTimeout(waitTimer);
            const result = request.data;

            if (result === 'BLOCKED') {
                console.warn("⚠️ 遭遇风控滑块拦截！");
                if (currentWaitingItem && currentWaitingItem.element) {
                    const badge = currentWaitingItem.element.querySelector('.zhilian-scraper-badge');
                    if (badge) {
                        badge.innerText = '⛔ 遭遇风控';
                        badge.style.background = '#f44336';
                    }
                    currentWaitingItem.element.style.boxShadow = '0 0 0 2px #f44336';
                    currentWaitingItem.element.style.transform = '';
                }
                isRunning = false;
                notifyPopupStatus('⚠️ 遭遇风控，请在弹出的新标签页过验证');
                return;
            }

            if (result === 'TIMEOUT') {
                console.warn("⚠️ 详情页解析失败，可能是反爬或无数据");
                if (currentWaitingItem && currentWaitingItem.element) {
                    const badge = currentWaitingItem.element.querySelector('.zhilian-scraper-badge');
                    if (badge) {
                        badge.innerText = '⚠️ 解析失败';
                        badge.style.background = '#f44336';
                    }
                    currentWaitingItem.element.style.boxShadow = '0 0 0 2px #f44336';
                    currentWaitingItem.element.style.transform = '';
                }
                isRunning = false;
                notifyPopupStatus('⚠️ 详情页解析失败，已自动暂停');
                return;
            }

            // 合并并保存
            const jobDetail = result;
            const now = new Date();
            const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

            const mergedData = { ...currentWaitingItem, ...jobDetail };
            mergedData['更新时间'] = timeStr;
            mergedData['抓取时间'] = timeStr;
            mergedData['平台'] = 'zhilian';
            mergedData.platform = 'zhilian';

            const existingIndex = allScrapedData.findIndex(j => j['职位ID'] === mergedData['职位ID']);
            if (existingIndex !== -1) {
                mergedData['创建时间'] = allScrapedData[existingIndex]['创建时间'] || timeStr;
                allScrapedData[existingIndex] = mergedData;
            } else {
                mergedData['创建时间'] = timeStr;
                allScrapedData.push(mergedData);
            }

            delete mergedData.url;
            delete mergedData.jobName;

            if (mergedData['干净链接']) sessionProcessedUrls.add(mergedData['干净链接']);
            saveData(allScrapedData, mergedData);

            notifyPopupStatus(`成功抓取: ${mergedData['职位名称']}`);
            console.log(`✅ [${currentIndex + 1}/${scrapedList.length}] 抓取完成: ${mergedData['职位名称']}`);

            if (currentWaitingItem && currentWaitingItem.element) {
                const badge = currentWaitingItem.element.querySelector('.zhilian-scraper-badge');
                if (badge) {
                    badge.innerText = '✅ 抓取成功';
                    badge.style.background = '#4CAF50';
                }
                currentWaitingItem.element.style.boxShadow = '0 0 0 2px #4CAF50';
                currentWaitingItem.element.style.transform = '';
            }

            currentIndex++;
            currentWaitingItem = null;
            setTimeout(() => { if (isRunning) processNext(); }, getRandomInt(600, 1500));
        }
    });

    function processNext() {
        if (!isRunning) return;

        if (currentIndex >= scrapedList.length) {
            notifyPopupStatus('本页处理完毕，准备翻页...');
            let nextBtn = Array.from(document.querySelectorAll('button, a')).find(el =>
                el.innerText && el.innerText.trim() === '下一页' &&
                !el.disabled &&
                !el.classList.contains('soupager__btn--disable') &&
                !el.classList.contains('disabled') &&
                !el.classList.contains('is-disabled') &&
                !el.classList.contains('ant-pagination-disabled')
            );

            if (nextBtn) {
                nextBtn.click();
                notifyPopupStatus('准备翻页，等待页面加载...');
                setTimeout(() => {
                    if (isRunning) {
                        notifyPopupStatus('正在提取新页面列表...');
                        extractListAndContinue();
                    }
                }, 3000);
            } else {
                isRunning = false;
                notifyPopupStatus('抓取完成：已到达最后一页');
            }
            return;
        }

        const item = scrapedList[currentIndex];

        // 重置之前高亮的卡片样式
        scrapedList.forEach(i => {
            if (i.element && i !== item) {
                i.element.style.boxShadow = '';
                i.element.style.transform = '';
                i.element.style.transition = 'all 0.3s ease';
                i.element.style.zIndex = '1';
                const badge = i.element.querySelector('.zhilian-scraper-badge');
                if (badge && badge.innerText.includes('正在抓取')) badge.remove();
            }
        });

        if (sessionProcessedUrls.has(item.url)) {
            if (item.element) {
                item.element.style.opacity = '0.5';
                const badge = document.createElement('div');
                badge.className = 'zhilian-scraper-badge';
                badge.style.cssText = 'position: absolute; top: 10px; right: 10px; background: #9e9e9e; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; z-index: 10; pointer-events: none;';
                badge.innerText = '已跳过';
                item.element.style.position = 'relative';
                item.element.appendChild(badge);
            }
            currentIndex++;
            processNext();
            return;
        }

        // 滚动并高亮当前卡片
        if (item.element) {
            item.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            item.element.style.boxShadow = '0 0 20px rgba(255, 69, 0, 0.8), 0 0 0 3px #ff4500';
            item.element.style.transform = 'scale(1.02)';
            item.element.style.transition = 'all 0.3s ease';
            item.element.style.zIndex = '100';
            item.element.style.position = 'relative';

            const badge = document.createElement('div');
            badge.className = 'zhilian-scraper-badge';
            badge.style.cssText = 'position: absolute; top: 10px; right: 10px; background: #ff4500; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; z-index: 10; pointer-events: none; box-shadow: 0 2px 4px rgba(0,0,0,0.2);';
            badge.innerText = '🔄 正在抓取...';
            item.element.appendChild(badge);
        }

        notifyPopupStatus(`[${currentIndex + 1}/${scrapedList.length}] 后台加载中: ${item.jobName}`);
        console.log(`[${currentIndex + 1}/${scrapedList.length}] 请求URL: ${item.url}`);

        currentWaitingItem = item;

        // 发送给 Background 要求开窗
        localStorage.setItem('zhilian_scraper_target', item.url);
        chrome.runtime.sendMessage({ action: 'ZHILIAN_OPEN_TAB', url: item.url });

        // 超时保护
        waitTimer = setTimeout(() => {
            if (isRunning && currentWaitingItem === item) {
                console.warn(`[超时] 职位 ${item.url} 抓取超时`);
                if (item.element) {
                    const badge = item.element.querySelector('.zhilian-scraper-badge');
                    if (badge) {
                        badge.innerText = '⚠️ 请求超时';
                        badge.style.background = '#f44336';
                    }
                    item.element.style.boxShadow = '0 0 0 2px #f44336';
                    item.element.style.transform = '';
                }
                chrome.runtime.sendMessage({ action: 'ZHILIAN_CLOSE_TAB' });

                // 超时直接停止抓取并弹窗提示
                isRunning = false;
                chrome.storage.local.set({ isZhilianScraping: false });
                notifyPopupStatus('已因超时/风控自动停止');
                currentWaitingItem = null;

                alert(`🚨 职位获取详情超时！\n\n原因：通常是因为抓取速度过快触发了智联招聘官方风控（可能弹出了验证页面）。\n\n插件已自动停止工作。请你手动打开任一职位详情页处理验证，确认能正常看到页面后，再点击开始抓取。`);
            }
        }, 15000);
    }

    function extractListAndContinue() {
        const jobCards = document.querySelectorAll('.joblist-box__item');
        if (jobCards.length === 0) {
            notifyPopupStatus('未找到职位列表，请确认在智联搜索页，或可能已被风控拦截');
            isRunning = false;
            return;
        }

        scrapedList = Array.from(jobCards).map(card => {
            const linkEl = card.querySelector('.jobinfo__name');
            const detailUrl = linkEl ? linkEl.href.split('?')[0] : '';
            return {
                jobName: linkEl ? linkEl.innerText.trim() : '未知职位',
                url: detailUrl,
                element: card
            };
        }).filter(item => item.url);

        if (scrapedList.length > 0) {
            currentIndex = 0;
            notifyPopupStatus(`提取到 ${scrapedList.length} 个职位，开始处理本页...`);
            processNext();
        } else {
            notifyPopupStatus('未提取到有效的职位链接');
            isRunning = false;
        }
    }

    function startScraping() {
        if (isRunning) return;
        isRunning = true;

        chrome.storage.local.get([currentSource], function (result) {
            allScrapedData = result[currentSource] || [];
            extractListAndContinue();
        });
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'start_zhilian_ssr') {
            currentSource = 'zhilian_scraped_data_v1';
            startScraping();
            sendResponse({ status: "started" });
        } else if (request.action === 'stop_zhilian_ssr') {
            isRunning = false;
            notifyPopupStatus('已停止抓取');
            sendResponse({ status: "stopped" });
        } else if (request.action === 'get_status_ssr') {
            sendResponse({ isRunning: isRunning, status: "ok" });
        }
    });

    // === 详情页自动探测职位关闭 ===
    if (window.location.href.includes('zhaopin.com/job/')) {
        setTimeout(() => {
            const bodyText = document.body.innerText || "";
            const isClosed = bodyText.includes('职位已停止招聘') ||
                bodyText.includes('职位已关闭') ||
                bodyText.includes('页面已下线') ||
                bodyText.includes('职位已下线') ||
                bodyText.includes('职位不存在');

            // if (isClosed) {
            //     const m = location.href.match(/\/job\/([^.?#]+)\.html?/);
            //     const jobId = m ? m[1] : null;
            //     if (jobId) {
            //         fetch(`http://localhost:3000/api/jobs/${jobId}/status`, {
            //             method: 'PUT',
            //             headers: { 'Content-Type': 'application/json' },
            //             body: JSON.stringify({ status: 'expired' })
            //         }).catch(() => { });
            //     }
            // }
        }, 2000);
    }

})();


