(function () {
    'use strict';

    if (window !== window.parent) return;

    let isRunning = false;
    let isAutoScroll = true;
    let currentList = [];
    let currentIndex = 0;
    let scrapedData = [];
    let scrapedIds = new Set();
    let sessionProcessedIds = new Set(); // Track jobs processed in current run to prevent infinite loops
    let interceptedListJobs = new Map();
    let interceptedDetailJobs = new Map(); // Store intercepted list JSON items
    let waitTimer = null;
    let jobsScrapedSinceRest = 0;
    let nextRestLimit = getRandomInt(8, 12);
    let scrollSessionInterceptedCount = 0;
    let scrollSessionHasNewJobs = false;
    let lastJobListHasMore = null;
    let lastJobListInterceptedTime = 0;

    function getRandomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

    function cleanStr(str) {
        if (str == null) return '';
        if (Array.isArray(str)) str = str.join(' / ');
        return String(str).replace(/[\r\n]+/g, ' ').replace(/"/g, '""').trim();
    }

    function cleanMultiLineStr(str) {
        if (str == null) return '';
        if (Array.isArray(str)) str = str.join('\n');
        return String(str).replace(/"/g, '""').trim();
    }

    function loadCache(callback) {
        chrome.storage.local.get(['boss_scraped_v2'], (res) => {
            scrapedData = Array.isArray(res.boss_scraped_v2) ? res.boss_scraped_v2 : [];
            scrapedIds = new Set(scrapedData.map(d => d['职位ID']).filter(Boolean));
            if (callback) callback();
        });
    }

    function saveCache(callback, newRow = null) {
        chrome.storage.local.set({ boss_scraped_v2: scrapedData }, () => {
            notifyPopupCount();
            if (callback) callback();
        });

        // 将新增或更新的数据推送到本地服务器进行测试
        if (newRow) {
            fetch('http://localhost:3000/api/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([newRow])
            }).then(r => r.json()).then(res => {
                if (res && res.changedJobs && res.changedJobs.length > 0) {
                    const c = res.changedJobs[0];
                    console.log(`%c[Job Monitor] ⚠️ 发现岗位变更: 【${c.companyName}】${c.title} -> ${c.reason || '内容更新'}`, 'color: #ea580c; font-weight: bold;');
                    if (typeof notifyPopupStatus === 'function') {
                        notifyPopupStatus(`⚠️ 岗位【${c.title}】变更: ${c.reason || '内容更新'}`);
                    }
                }
            }).catch(err => {
                // 如果本地服务器未开启，这里会忽略错误，不影响原有逻辑
                console.log('[Boss Scraper] Local server sync failed (expected if not running):', err);
            });

            // https://job-dashboard-bgr.pages.dev
            // 远程的先不同步数据了，但是代码保留可以
            // fetch('https://job-dashboard-bgr.pages.dev/api/jobs', {
            //     method: 'POST',
            //     headers: { 'Content-Type': 'application/json' },
            //     body: JSON.stringify([newRow])
            // }).catch(err => {
            //     // 如果本地服务器未开启，这里会忽略错误，不影响原有逻辑
            //     console.log('[Boss Scraper] Remote server sync failed (expected if not running):', err);
            // });
        }
    }

    function notifyPopupStatus(statusText) {
        chrome.runtime.sendMessage({
            action: 'boss_update_status',
            isRunning,
            status: statusText
        });
    }

    function notifyPopupCount() {
        chrome.runtime.sendMessage({
            action: 'boss_update_count',
            count: scrapedData.length
        });
    }

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'boss_start') {
                isAutoScroll = request.autoScroll !== false;
                // 删除 sessionProcessedIds.clear(); 以便暂停后继续抓取时不会从头开始
                if (!isRunning) {
                    loadCache(() => {
                        startScraping();
                    });
                }
            } else if (request.action === 'boss_stop') {
                isRunning = false;
                clearTimeout(waitTimer);
                notifyPopupStatus('已暂停');
            } else if (request.action === 'boss_clear') {
                scrapedData = [];
                scrapedIds.clear();
                sessionProcessedIds.clear();
                lastJobListHasMore = null;
            } else if (request.action === 'boss_get_status') {
                sendResponse({ isRunning, status: isRunning ? '正在运行...' : '闲置' });
            } else if (request.action === 'boss_scrape_single') {
                if (!location.href.includes('/job_detail/')) {
                    alert('当前页面不是 Boss 直聘职位详情页！');
                    return;
                }
                loadCache(() => {
                    scrapeSinglePage();
                });
            } else if (request.action === 'boss_scan_chat_blacklist') {
                scanAndExtractChatBlacklist();
            }
        });
    } else {
        console.warn("[Boss Scraper] chrome.runtime.onMessage API 不可用");
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data) return;
        if (event.data.type === 'BOSS_JOB_LIST') {
            const data = event.data.data;
            const zpData = (data && (data.zpData || data.data)) || {};
            const jobList = zpData.jobList || [];

            if (zpData.hasMore !== undefined) {
                lastJobListHasMore = zpData.hasMore;
            }
            lastJobListInterceptedTime = Date.now();
            scrollSessionInterceptedCount++;

            let hasNewInSession = false;
            jobList.forEach(job => {
                if (job.encryptJobId) {
                    interceptedListJobs.set(job.encryptJobId, job);
                    if (!sessionProcessedIds.has(job.encryptJobId)) {
                        hasNewInSession = true;
                    }
                }
            });
            if (hasNewInSession) {
                scrollSessionHasNewJobs = true;
            }
        } else if (event.data.type === 'BOSS_JOB_DETAIL') {
            const data = event.data.data;
            const jobInfo = data.jobInfo || (data.zpData && data.zpData.jobInfo) || (data.data && data.data.jobInfo) || {};
            const jobId = cleanStr(jobInfo.encryptId);
            if (jobId) {
                interceptedDetailJobs.set(jobId, data);
            }

            if (isRunning) {
                onDetailApiCaptured(data);
            }
        }
    });

    function formatActiveTime(desc) {
        let activeTime = cleanStr(desc);
        if (activeTime === '刚刚活跃' || activeTime === '今日活跃' || activeTime === '在线') {
            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            activeTime = `${yyyy}-${mm}-${dd}`;
        }
        return activeTime;
    }

    // Insert or Overwrite the scraped job data
    function upsertData(jobId, row, callback) {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const todayStr = `${yyyy}-${mm}-${dd}`;

        const existingIndex = scrapedData.findIndex(d => (d.jobId || d['职位ID'] || (d.zpData && d.zpData.jobInfo && d.zpData.jobInfo.encryptId) || (d.jobInfo && d.jobInfo.encryptId)) === jobId);
        if (existingIndex >= 0) {
            // Keep deep fetch data if existing row has it and new row does not
            const oldRow = scrapedData[existingIndex];
            row['_fetched_companyFullName'] = row['_fetched_companyFullName'] || oldRow['_fetched_companyFullName'] || oldRow['公司全称'];
            row['_fetched_fullAddress'] = row['_fetched_fullAddress'] || oldRow['_fetched_fullAddress'] || oldRow['详细完整地址'];
            row['_fetched_updateTime'] = row['_fetched_updateTime'] || oldRow['_fetched_updateTime'] || oldRow['页面更新时间'];

            row['创建时间'] = oldRow['创建时间'] || todayStr;
            row['更新时间'] = todayStr;
            row['平台'] = 'boss';
            row.platform = 'boss';

            scrapedData[existingIndex] = row;
        } else {
            row['创建时间'] = todayStr;
            row['更新时间'] = todayStr;
            row['平台'] = 'boss';
            row.platform = 'boss';

            scrapedData.push(row);
        }
        scrapedIds.add(jobId);
        saveCache(callback, row);
    }

    function onDetailApiCaptured(json) {

        clearTimeout(waitTimer);

        const data = json.zpData || json.data || json;
        if (!data || !data.jobInfo) {
            console.error('[Boss Scraper] API captured but no jobInfo found:', json);
            scheduleNextJob();
            return;
        }

        const job = data.jobInfo || {};
        const jobId = cleanStr(job.encryptId);

        if (!jobId) {
            scheduleNextJob();
            return;
        }

        let row;
        if (interceptedListJobs.has(jobId)) {
            // Use the list item as the base row
            row = JSON.parse(JSON.stringify(interceptedListJobs.get(jobId)));
            // Merge the detail JSON into the jobDetail property
            row.jobDetail = json;
        } else {
            // Fallback: if we didn't catch the list API, just save the detail JSON directly
            row = { ...json };
        }

        row.jobId = jobId;
        row.platform = 'boss';
        row.dataSource = 'boss_scraped_v2';
        row['平台'] = 'boss';
        row['数据来源'] = 'boss_scraped_v2';

        upsertData(jobId, row, () => {
            console.log(`✅ [已更新 ${scrapedData.length}] ${job.jobName || ''} | ${job.salaryDesc || ''}`);
            scheduleNextJob();
        });
    }


    function scrapeSinglePage() {
        try {
            const m = location.href.match(/\/job_detail\/([^.?#]+)\.html/);
            const jobId = m ? m[1] : `ID_${Date.now()}`;

            const row = {
                '职位ID': jobId,
                '平台': 'boss',
                '数据来源': 'boss_single_details',
                'platform': 'boss',
                'dataSource': 'boss_single_details',
                '职位名称': cleanStr(document.querySelector('.info-primary .name h1')?.textContent),
                '招聘状态': cleanStr(document.querySelector('.job-status')?.textContent),
                '薪资待遇': cleanStr(document.querySelector('.info-primary .name .salary')?.textContent),
                '工作地点': '',
                '工作经验': '',
                '学历要求': '',
                '职位描述': cleanMultiLineStr(document.querySelector('.job-detail-section .job-sec-text')?.innerText),
                '技能标签': Array.from(document.querySelectorAll('.job-keyword-list li')).map(el => cleanStr(el.textContent)).join(','),
                'HR姓名': cleanStr(document.querySelector('h2.name')?.childNodes[0]?.textContent),
                'HR职位': cleanStr(document.querySelector('.boss-info-attr')?.textContent),
                'HR活跃度': formatActiveTime(document.querySelector('.boss-active-time')?.textContent || document.querySelector('.boss-online-tag')?.textContent),
                '公司名称': cleanStr(document.querySelector('.sider-company .company-info a[ka="job-detail-company_custompage"]')?.textContent) || cleanStr(document.querySelector('.sider-company .company-info a[title]')?.getAttribute('title')) || cleanStr(document.querySelector('.company-info a[ka="job-detail-company_custompage"]')?.textContent),
                '公司行业': cleanStr(document.querySelector('.sider-company .icon-industry')?.parentElement?.textContent),
                '公司规模': cleanStr(document.querySelector('.sider-company .icon-scale')?.parentElement?.textContent),
                '公司福利': Array.from(document.querySelectorAll('.tag-container-new .job-tags span')).map(el => cleanStr(el.textContent)).join(','),
                '公司全称': '',
                '法定代表人': '',
                '成立日期': '',
                '企业类型': '',
                '经营状态': '',
                '注册资金': '',
                '公司ID': '',
                '详细完整地址': cleanStr(document.querySelector('.location-address')?.textContent),
                '页面更新时间': '',
                '最后刷新时间': document.querySelector('meta[property="bytedance:lrDate_time"]')?.content || '',
                '精确更新时间': document.querySelector('meta[property="bytedance:updated_time"]')?.content || ''
            };

            const basicInfo = document.querySelector('.info-primary p')?.textContent || '';
            const basicParts = basicInfo.split(/[\s·]+/).map(cleanStr).filter(Boolean);
            if (basicParts.length >= 3) {
                row['工作地点'] = basicParts[0];
                row['工作经验'] = basicParts[1];
                row['学历要求'] = basicParts[2];
            } else if (basicParts.length >= 1) {
                row['工作地点'] = basicParts[0];
            }

            const updateNode = document.querySelector('p.gray');
            if (updateNode && updateNode.textContent.includes('页面更新时间')) {
                row['页面更新时间'] = cleanStr(updateNode.textContent.replace('页面更新时间：', ''));
            }

            const bInfoBox = document.querySelector('.business-info-box');
            if (bInfoBox) {
                const extractLi = (className) => {
                    const node = bInfoBox.querySelector(`li.${className}`);
                    if (!node) return '';
                    let text = '';
                    node.childNodes.forEach(child => {
                        if (child.nodeType === Node.TEXT_NODE) text += child.nodeValue;
                    });
                    return cleanStr(text);
                };
                row['公司全称'] = extractLi('company-name');
                row['法定代表人'] = extractLi('company-user');
                row['成立日期'] = extractLi('res-time');
                row['企业类型'] = extractLi('company-type');
                row['经营状态'] = extractLi('manage-state');
                row['注册资金'] = extractLi('company-fund');

                // 可以提取到 公司ID 的元素有： 
                // 1. a[ka="job-cominfo"]
                // 2. a[ka="job-detail-company-logo_custompage"]
                // 3. a[ka="job-detail-company_custompage"]
                // 4. a[ka="job-comintroduce"]
                const comLink = bInfoBox.querySelector('a[ka="job-cominfo"]');
                if (comLink) {
                    const href = comLink.getAttribute('href') || '';
                    const match = href.match(/\/gongsi\/([^.?#]+)\.html/);
                    if (match && match[1]) {
                        row['公司ID'] = match[1];
                    }
                }
            }

            row['抓取时间'] = new Date().toLocaleString();

            // 详情页单独存放逻辑：存入专门的 boss_single_details 库，并不再同步关键字段到 boss_scraped_v2
            chrome.storage.local.get(['boss_single_details', 'boss_companies_scraped'], (res) => {
                const list = res.boss_single_details || [];
                const idx = list.findIndex(item => item['职位ID'] === jobId);
                if (idx >= 0) {
                    list[idx] = row;
                } else {
                    list.push(row);
                }

                const compList = res.boss_companies_scraped || [];
                let currentCompData = null;
                if (row['公司ID'] || row['公司全称']) {
                    const cId = row['公司ID'];
                    const cName = row['公司全称'];

                    const cIdx = compList.findIndex(c => (cId && c['公司ID'] === cId) || (!cId && c['公司全称'] === cName));

                    const compData = {
                        '公司ID': cId || '',
                        '公司全称': cName || '',
                        '公司名称': row['公司名称'] || '',
                        '法定代表人': row['法定代表人'] || '',
                        '成立日期': row['成立日期'] || '',
                        '企业类型': row['企业类型'] || '',
                        '经营状态': row['经营状态'] || '',
                        '注册资金': row['注册资金'] || '',
                        '公司行业': row['公司行业'] || '',
                        '公司规模': row['公司规模'] || '',
                        '公司福利': row['公司福利'] || '',
                        '详细完整地址': row['详细完整地址'] || '',
                        'sourcePlatform': 'Boss直聘',
                        'platform': 'boss',
                        '更新时间': new Date().toLocaleString()
                    };
                    currentCompData = compData;

                    if (cIdx >= 0) {
                        compList[cIdx] = { ...compList[cIdx], ...compData };
                    } else {
                        compData['创建时间'] = compData['更新时间'];
                        compList.push(compData);
                    }
                }

                chrome.storage.local.set({
                    'boss_single_details': list,
                    'boss_companies_scraped': compList
                }, () => {
                    showToast('✅ 职位详情已自动抓取，关键数据已同步至主库！');
                });

                // 推送到本地服务器进行测试
                // if (mainIdx >= 0) {
                //     const jobToSync = { ...mainList[mainIdx], boss_single_detail: row };
                //     fetch('http://localhost:3000/api/jobs', {
                //         method: 'POST',
                //         headers: { 'Content-Type': 'application/json' },
                //         body: JSON.stringify([jobToSync])
                //     }).catch(err => {
                //         console.log('[Boss Scraper] Local server sync failed:', err);
                //     });
                // }

                // 单独推送职位详情数据 到本地服务
                fetch('http://localhost:3000/api/job-details', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify([row])
                }).catch(err => {
                    console.log('[Boss Scraper] Local server single detail sync failed:', err);
                });

                // 同步提取到的企业工商数据到本地企业库
                if (currentCompData) {
                    fetch('http://localhost:3000/api/companies', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify([currentCompData])
                    }).catch(err => {
                        console.log('[Boss Scraper] Local server company sync failed:', err);
                    });
                }

                // 推送职位详情数据 到远程服务 (已注释)
                // https://job-dashboard-bgr.pages.dev
                // fetch('https://job-dashboard-bgr.pages.dev/api/job-details', {
                //     method: 'POST',
                //     headers: { 'Content-Type': 'application/json' },
                //     body: JSON.stringify([row])
                // }).catch(err => {
                //     // 如果远程服务器未开启，这里会忽略错误，不影响原有逻辑
                //     console.log('[Boss Scraper] Remote server sync failed (expected if not running):', err);
                // });
            });

        } catch (err) {
            console.error('[Boss Scraper] 抓取详情页时报错:', err);
            showToast('❌ 抓取报错: ' + err.message);
        }
    }

    // 页面提示 Toast
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
        document.querySelectorAll('.job-card-wrap').forEach(cardWrap => {
            const nameLink = cardWrap.querySelector('a.job-name') || cardWrap.querySelector('a[href*="/job_detail/"]');
            if (!nameLink) return;
            const href = nameLink.getAttribute('href') || '';
            const m = href.match(/\/job_detail\/([^.?#]+)\.html/);
            if (m) {
                const jobId = m[1];
                let securityId = '';
                let lid = '';
                try {
                    // 尝试从 URL 参数中解析 securityId 和 lid
                    const urlObj = new URL(href, 'https://www.zhipin.com');
                    securityId = urlObj.searchParams.get('securityId') || '';
                    lid = urlObj.searchParams.get('lid') || '';
                } catch (e) { }

                if (!seen.has(jobId)) {
                    seen.add(jobId);
                    list.push({ jobId, securityId, lid, el: cardWrap, link: nameLink });
                }
            }
        });
        return list;
    }

    function startScraping() {
        const allJobs = collectJobsFromDOM();
        if (allJobs.length === 0) {
            alert('未发现职位卡片！请先搜索职位，等列表加载完毕后再开始。');
            isRunning = false;
            notifyPopupStatus('出错: 未发现职位卡片');
            return;
        }

        // Filter based on sessionProcessedIds to avoid clicking the same card multiple times in this single run
        currentList = allJobs.filter(j => !sessionProcessedIds.has(j.jobId));
        currentIndex = 0;
        isRunning = true;

        if (currentList.length === 0) {
            if (isAutoScroll) { loadMoreByScroll(); }
            else {
                alert('当前所有可见职位已全部抓取！');
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

        try { job.el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { }

        setTimeout(() => {
            const cachedDetail = interceptedDetailJobs.get(job.jobId);

            if (cachedDetail) {
                // 如果记忆库里已经有这个职位的详情数据（比如刚进页面就自动加载的第一个职位）
                // 我们就不需要模拟点击，也不需要去重新 Fetch，直接拿着数据用！
                onDetailApiCaptured(cachedDetail);
            } else {
                // 根据你的要求，这里改为“阶梯式”顺序执行。
                // 只要某一步成功触发了 API，拦截器收到数据后会调用 onDetailApiCaptured，
                // 里面的 clearTimeout(waitTimer) 就会立刻掐断后续所有的执行计划！


                // 保持原有的模拟点击逻辑不变（触发左右分栏布局加载）
                try { job.link.click(); } catch (e) { }

                // 新增功能：通过后台隐式打开一个新的标签页加载职位详情 (暂时停用)
                /* 
                if (job.link) {
                    const originalHref = job.link.getAttribute('href');
                    if (originalHref) {
                        const separator = originalHref.includes('?') ? '&' : '?';
                        const newTabUrl = originalHref + separator + 'auto_close=1';
                        // 使用绝对路径以防 originalHref 是相对路径
                        const absoluteUrl = new URL(newTabUrl, window.location.origin).href;

                        try {
                            chrome.runtime.sendMessage({ action: 'BOSS_OPEN_TAB', url: absoluteUrl });
                        } catch (e) { }
                    }
                }
                */

                // 等待 2 秒，如果第一步没成功（没有被 clearTimeout 掐断），则自动执行第二步
                waitTimer = setTimeout(() => {
                    try { job.el.click(); } catch (e) { }

                    // 再等待 2 秒，如果第二步也没成功，则自动执行第三步
                    waitTimer = setTimeout(() => {
                        // 根据你的要求，注释掉模拟人类鼠标的部分
                        // simulateRealClick(job.link);
                        // simulateRealClick(job.el);

                        // 最后等待 4 秒，如果所有点击都被 Boss 直聘屏蔽了，启动终极兜底
                        waitTimer = setTimeout(() => {
                            const listObj = interceptedListJobs.get(job.jobId);
                            const securityId = (listObj && listObj.securityId) || job.securityId;
                            const lid = (listObj && listObj.lid) || job.lid;

                            if (securityId) {
                                const url = `/wapi/zpgeek/job/detail.json?securityId=${encodeURIComponent(securityId)}&lid=${encodeURIComponent(lid || '')}`;
                                fetch(url).then(res => res.json()).then(json => {
                                    onDetailApiCaptured(json);
                                }).catch(e => {
                                    scheduleNextJob();
                                });
                            } else {
                                scheduleNextJob();
                            }
                        }, 4000); // 步骤3 专属 4 秒等待
                    }, 2000); // 步骤2 专属 2 秒等待
                }, 2000); // 步骤1 专属 2 秒等待
            }

            function simulateRealClick(element) {
                if (!element) return;
                try {
                    ['mousedown', 'mouseup', 'click'].forEach(eventType => {
                        const event = new MouseEvent(eventType, {
                            view: window,
                            bubbles: true,
                            cancelable: true,
                            buttons: 1
                        });
                        element.dispatchEvent(event);
                    });
                } catch (e) { }
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

        // 适当控制抓取节奏，每次抓完一个职位随机等待 1.5秒 到 3.5秒，防封号
        const delay = getRandomInt(1500, 3500);
        notifyPopupStatus(`安全休眠 ${(delay / 1000).toFixed(1)}s`);
        setTimeout(() => {
            processNext();
        }, delay);
    }

    function loadMoreByScroll() {
        notifyPopupStatus(`等待新数据加载...`);

        let tries = 0;
        scrollSessionInterceptedCount = 0;
        scrollSessionHasNewJobs = false;

        const poll = setInterval(() => {
            if (!isRunning) {
                clearInterval(poll);
                return;
            }
            tries++;

            // 1. 温柔滚动，每 6 次尝试进行一次大跨度滚动以触发触底监听
            if (tries % 6 === 0) {
                window.scrollBy({ top: 600, behavior: 'smooth' });
            } else {
                window.scrollBy({ top: 350, behavior: 'smooth' });
            }

            // 2. 检测 DOM 中是否已有未被本轮处理的新职位卡片渲染出来
            const newJobs = collectJobsFromDOM().filter(j => !sessionProcessedIds.has(j.jobId));
            if (newJobs.length > 0) {
                clearInterval(poll);
                const wait = getRandomInt(1800, 3200);
                notifyPopupStatus(`新卡片已渲染，等待 ${(wait / 1000).toFixed(1)}s`);
                setTimeout(() => { if (isRunning) startScraping(); }, wait);
                return;
            }

            // 3. 【辅助判断一：接口明确返回已无更多数据】
            // 如果最近拦截到的列表 JSON 接口中明确带有 hasMore === false，且当前 DOM 已无新卡片，滚动确认数次后判定完毕
            if (lastJobListHasMore === false && tries >= 6) {
                clearInterval(poll);
                alert(`🎉 抓取完毕！服务端接口已明确返回无更多职位 (hasMore=false)，共缓存 ${scrapedData.length} 条数据。`);
                isRunning = false;
                notifyPopupStatus('完毕');
                return;
            }

            // 4. 【网络延迟保护：如果滚动期间刚刚拦截到了含有新职位的 JSON 响应】
            // 说明接口已响应，Vue DOM 正在挂载过程中，绝不能提前误判为结束，给予缓冲并重置部分重试计数
            if (scrollSessionHasNewJobs && (Date.now() - lastJobListInterceptedTime < 3500)) {
                notifyPopupStatus(`已拦截新职位数据，等待 DOM 渲染... (${tries})`);
                if (tries > 8) tries = 8;
                return;
            }

            // 5. 滚动至第 16 次时做一次强制触底以激活可能的 IntersectionObserver 监听
            if (tries === 16) {
                window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            }

            // 6. 【辅助判断二：多次向下滚动，且完全未拦截到新的列表 JSON 接口】
            // 持续向下滚动达到 24 次（约 12 秒），且满足：
            // ① DOM 始终没有新卡片渲染出来；
            // ② 并且没有拦截到任何含有新职位的 JSON 接口（或者根本未发起任何新的列表请求）；
            // 此时通过「DOM 到底 + 接口静默/无新数据」实现双重确认，真正判定全部抓取完毕！
            if (tries >= 24) {
                clearInterval(poll);
                const reason = scrollSessionInterceptedCount === 0
                    ? '多次向下滚动未触发任何列表 JSON 接口'
                    : '多次向下滚动接口未返回任何未处理新职位';
                console.log(`[Boss Scraper] 全部抓取完成判定触发: ${reason}`);
                alert(`🎉 抓取完毕！页面已触底且接口未返回新职位，共缓存 ${scrapedData.length} 条数据。`);
                isRunning = false;
                notifyPopupStatus('完毕');
            }
        }, 500);
    }

    // === 详情页自动抓取逻辑 ===
    if (location.href.includes('/job_detail/')) {
        // 延迟2秒等待DOM完全渲染，然后自动抓取
        setTimeout(() => {
            const m = location.href.match(/\/job_detail\/([^.?#]+)\.html/);
            const jobId = m ? m[1] : null;

            // const bodyText = document.body.innerText || "";
            // const isClosed = document.querySelector('.error-content') ||
            //     bodyText.includes('该职位已关闭') ||
            //     bodyText.includes('停止招聘') ||
            //     bodyText.includes('该职位已下线') ||
            //     bodyText.includes('职位不存在');

            // if (isClosed && jobId) {
            //     fetch(`http://localhost:3000/api/jobs/${jobId}/status`, {
            //         method: 'PUT',
            //         headers: { 'Content-Type': 'application/json' },
            //         body: JSON.stringify({ status: 'expired' })
            //     }).catch(() => { });
            // }

            scrapeSinglePage();

            // 如果是通过扩展程序脚本自动打开的标签页，抓取完成后延迟自动关闭
            if (location.href.includes('auto_close=1')) {
                setTimeout(() => {
                    // 关闭当前标签页
                    window.close();
                    // 兜底方案：如果 window.close() 被浏览器拦截，可以通过 runtime 消息让 background 关闭当前 tab
                    try {
                        chrome.runtime.sendMessage({ action: 'close_current_tab' });
                    } catch (e) { }
                }, 5000);
            }
        }, 2000);
    }

    // === 沟通聊天页面：一键反向提取企业黑名单 ===
    const REJECTION_KEYWORDS = [
        '不合适', '暂不匹配', '暂不考虑', '不符合', '暂不合适', '技能不符',
        '不太匹配', '不搭', '未能通过', '未通过',
        '需要本', '要求本', '必须统招', '学历不符', '要求全日制', '专业不符', '经验不符',
        '感谢关注', '很遗憾', '抱歉', '对不起', '感谢投递', '祝您早日', '祝您找到更合适',
        '招满', '招完', '已招到', '停止招聘', 'hc已满', 'HC已满', '职位已关闭', '暂无合适空缺', '岗位已停'
    ];

    const EXCLUSION_PATTERNS = [
        /不是/g, /不得不/g, /如果不/g, /不见不散/g, /不知/g,
        /不限/g, /不妨/g, /不耽误/g, /不影响/g, /不仅/g, /不论/g
    ];

    function checkRejection(msg) {
        if (!msg || typeof msg !== 'string') return false;
        let filtered = msg.trim();
        for (const pat of EXCLUSION_PATTERNS) {
            filtered = filtered.replace(pat, '');
        }
        for (const kw of REJECTION_KEYWORDS) {
            if (filtered.includes(kw)) return true;
        }
        if (/感谢.*但/i.test(filtered) || /遗憾.*无法/i.test(filtered) || /抱歉.*目前/i.test(filtered)) return true;
        return false;
    }

    function scanAndExtractChatBlacklist() {
        const chatItems = document.querySelectorAll('li[role="listitem"], .geek-chat-list li, .chat-conversation li, .item-box');
        if (!chatItems || chatItems.length === 0) {
            alert('未检测到聊天列表项，请确保当前处于 Boss 直聘沟通页面 (https://www.zhipin.com/web/geek/chat) 且列表已加载。');
            return;
        }

        const candidateCompanies = [];
        const seenCompanies = new Set();

        chatItems.forEach(item => {
            let compElem = item.querySelector('.title-box .name-box span:nth-child(2)') ||
                           item.querySelector('.name-box span:nth-child(2)') ||
                           item.querySelector('.title-box .name-box') ||
                           item.querySelector('.name-box') ||
                           item.querySelector('.company-name');
            let compName = compElem ? compElem.textContent.trim() : '';

            let msgElem = item.querySelector('.last-msg .last-msg-text') ||
                          item.querySelector('.last-msg-text') ||
                          item.querySelector('.last-msg') ||
                          item.querySelector('.text');
            let msgText = msgElem ? msgElem.textContent.trim() : '';

            if (compName) {
                compName = compName.replace(/[·.]{2,}/g, '').replace(/^[【\[(（][^】\])）]+[】\])）]/g, '').trim();
            }

            if (compName && compName.length >= 2 && !seenCompanies.has(compName)) {
                if (checkRejection(msgText)) {
                    seenCompanies.add(compName);
                    candidateCompanies.push({
                        companyName: compName,
                        message: msgText,
                        reason: `沟通婉拒: ${msgText.slice(0, 80)}`,
                        checked: true
                    });
                }
            }
        });

        showBlacklistPreviewModal(candidateCompanies, chatItems.length);
    }

    function showBlacklistPreviewModal(candidates, scannedTotal) {
        const oldModal = document.getElementById('chat-blacklist-modal');
        if (oldModal) oldModal.remove();

        const modal = document.createElement('div');
        modal.id = 'chat-blacklist-modal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(8px);
            z-index: 9999999; display: flex; align-items: center; justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;

        const card = document.createElement('div');
        card.style.cssText = `
            background: #ffffff; width: 560px; max-width: 90vw; max-height: 85vh;
            border-radius: 16px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            display: flex; flex-direction: column; overflow: hidden; animation: modalFadeIn 0.2s ease-out;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            padding: 20px 24px; border-bottom: 1px solid #f1f5f9; display: flex;
            justify-content: space-between; align-items: center; background: #fafafa;
        `;
        header.innerHTML = `
            <div>
                <h3 style="margin: 0; font-size: 17px; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 8px;">
                    <span>🚫 聊天反向提取企业黑名单</span>
                    <span style="font-size: 12px; font-weight: normal; background: #fee2e2; color: #b91c1c; padding: 2px 8px; border-radius: 999px;">
                        命中 ${candidates.length} 家
                    </span>
                </h3>
                <p style="margin: 4px 0 0 0; font-size: 13px; color: #64748b;">
                    共扫描当前已加载的 ${scannedTotal} 条会话，识别出 ${candidates.length} 家婉拒/停止招聘企业
                </p>
            </div>
            <button id="modal-close-btn" style="background: none; border: none; font-size: 20px; color: #94a3b8; cursor: pointer;">✕</button>
        `;

        const body = document.createElement('div');
        body.style.cssText = `padding: 16px 24px; overflow-y: auto; flex: 1; min-height: 180px;`;

        if (candidates.length === 0) {
            body.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: #64748b;">
                    <div style="font-size: 40px; margin-bottom: 12px;">🎉</div>
                    <div style="font-weight: 600; color: #334155; margin-bottom: 6px;">未发现明确婉拒记录</div>
                    <div style="font-size: 13px;">当前已加载的对话中暂无明确拒绝、学历限制或招满信息。若有更多历史对话，可先在页面向下滑动加载更多后再点击扫描。</div>
                </div>
            `;
        } else {
            let listHtml = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-size: 13px; color: #475569;">
                    <label style="cursor: pointer; display: flex; align-items: center; gap: 6px;">
                        <input type="checkbox" id="modal-select-all" checked> 全选 (${candidates.length})
                    </label>
                    <span style="color: #94a3b8; font-size: 12px;">提示：可取消勾选不需要拉黑的企业</span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 8px;">
            `;

            candidates.forEach((c, idx) => {
                listHtml += `
                    <div style="padding: 10px 14px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; display: flex; align-items: flex-start; gap: 10px;">
                        <input type="checkbox" class="candidate-chk" data-index="${idx}" ${c.checked ? 'checked' : ''} style="margin-top: 3px; cursor: pointer;">
                        <div style="flex: 1; min-width: 0;">
                            <div style="font-weight: 600; color: #1e293b; font-size: 14px;">${c.companyName}</div>
                            <div style="font-size: 12px; color: #e11d48; margin-top: 2px; word-break: break-all; line-height: 1.4;">
                                💬 ${c.message}
                            </div>
                        </div>
                    </div>
                `;
            });
            listHtml += `</div>`;
            body.innerHTML = listHtml;
        }

        const footer = document.createElement('div');
        footer.style.cssText = `
            padding: 16px 24px; border-top: 1px solid #f1f5f9; display: flex;
            justify-content: flex-end; align-items: center; gap: 12px; background: #fafafa;
        `;
        footer.innerHTML = `
            <button id="modal-cancel-btn" style="padding: 8px 16px; border: 1px solid #cbd5e1; background: #fff; color: #475569; border-radius: 8px; font-size: 14px; cursor: pointer;">关闭</button>
            ${candidates.length > 0 ? `
                <button id="modal-sync-btn" style="padding: 8px 20px; border: none; background: #ef4444; color: #fff; font-weight: 600; border-radius: 8px; font-size: 14px; cursor: pointer; display: flex; align-items: center; gap: 6px;">
                    <span>⛔ 一键同步至黑名单</span>
                </button>
            ` : ''}
        `;

        card.appendChild(header);
        card.appendChild(body);
        card.appendChild(footer);
        modal.appendChild(card);
        document.body.appendChild(modal);

        // Bind events
        const closeModal = () => modal.remove();
        header.querySelector('#modal-close-btn').addEventListener('click', closeModal);
        footer.querySelector('#modal-cancel-btn').addEventListener('click', closeModal);

        const selectAllChk = body.querySelector('#modal-select-all');
        if (selectAllChk) {
            selectAllChk.addEventListener('change', (e) => {
                const checked = e.target.checked;
                body.querySelectorAll('.candidate-chk').forEach(chk => {
                    chk.checked = checked;
                    const i = parseInt(chk.getAttribute('data-index'));
                    if (candidates[i]) candidates[i].checked = checked;
                });
            });
        }

        body.querySelectorAll('.candidate-chk').forEach(chk => {
            chk.addEventListener('change', (e) => {
                const i = parseInt(e.target.getAttribute('data-index'));
                if (candidates[i]) candidates[i].checked = e.target.checked;
            });
        });

        const syncBtn = footer.querySelector('#modal-sync-btn');
        if (syncBtn) {
            syncBtn.addEventListener('click', async () => {
                const selected = candidates.filter(c => c.checked);
                if (selected.length === 0) {
                    alert('请至少勾选一家要加入黑名单的企业！');
                    return;
                }

                syncBtn.disabled = true;
                syncBtn.textContent = '正在同步...';

                try {
                    const payload = {
                        companies: selected.map(s => ({
                            companyName: s.companyName,
                            reason: s.reason,
                            source: 'chat_rejection'
                        }))
                    };

                    const resp = await fetch('http://localhost:3000/api/blacklist', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    const res = await resp.json();

                    if (res && res.success) {
                        alert(`✅ 成功将 ${selected.length} 家企业加入黑名单！\n本地看板职位已自动隐藏过滤。`);
                        closeModal();
                    } else {
                        alert('同步失败: ' + (res?.error || '无法连接到本地看板服务'));
                        syncBtn.disabled = false;
                        syncBtn.textContent = '⛔ 一键同步至黑名单';
                    }
                } catch (err) {
                    alert('同步出错，请确保本地 Job Dashboard (http://localhost:3000) 正在运行！\n' + err.message);
                    syncBtn.disabled = false;
                    syncBtn.textContent = '⛔ 一键同步至黑名单';
                }
            });
        }
    }

    function initBossChatBlacklistExtractor() {
        if (document.getElementById('boss-chat-blacklist-trigger')) return;

        const floatBtn = document.createElement('div');
        floatBtn.id = 'boss-chat-blacklist-trigger';
        floatBtn.innerHTML = `
            <div style="
                position: fixed; right: 28px; bottom: 85px; z-index: 99999;
                background: linear-gradient(135deg, #ef4444, #dc2626);
                color: #fff; padding: 10px 18px; border-radius: 999px;
                box-shadow: 0 10px 25px -5px rgba(239, 68, 68, 0.5), 0 8px 10px -6px rgba(239, 68, 68, 0.4);
                cursor: pointer; display: flex; align-items: center; gap: 8px;
                font-size: 14px; font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                border: 2px solid rgba(255, 255, 255, 0.2);
            " onmouseover="this.style.transform='scale(1.05) translateY(-2px)'" onmouseout="this.style.transform='none'">
                <span>🚫</span>
                <span>扫描婉拒企业拉黑</span>
            </div>
        `;

        floatBtn.addEventListener('click', () => {
            scanAndExtractChatBlacklist();
        });

        document.body.appendChild(floatBtn);
    }

    if (location.href.includes('/web/geek/chat')) {
        setTimeout(initBossChatBlacklistExtractor, 1500);
    }
})();
