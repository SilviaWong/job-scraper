(function () {
    'use strict';

    if (window !== window.parent) return;

    let isRunning = false;
    let isAutoScroll = true;
    let isSkipScraped = true;
    let isListOnlyMode = false;
    let currentList = [];
    let currentIndex = 0;
    let scrapedData = [];
    let scrapedIds = new Set();
    let blacklistedCompanies = new Set();
    let sessionProcessedIds = new Set(); // Track jobs processed in current run to prevent infinite loops
    let interceptedListJobs = new Map();
    let interceptedDetailJobs = new Map(); // Store intercepted list JSON items
    let waitTimer = null;
    let scrollPollTimer = null;
    let restCountdownTimer = null;
    let currentStepToken = 0;
    let isWaitingForDetail = false;
    let currentProcessingJobId = null;
    let jobsScrapedSinceRest = 0;
    let nextRestLimit = getRandomInt(8, 14);
    let sessionDetailClickCount = 0;
    let nextDeepCooldownLimit = getRandomInt(50, 65); // 每连续点击 50~65 条触发一次深度冷却并自动续抓
    let scrollSessionInterceptedCount = 0;
    let scrollSessionHasNewJobs = false;
    let lastJobListHasMore = null;
    let lastJobListInterceptedTime = 0;

    function clearAllTimers() {
        if (waitTimer) {
            clearTimeout(waitTimer);
            waitTimer = null;
        }
        if (scrollPollTimer) {
            clearTimeout(scrollPollTimer);
            clearInterval(scrollPollTimer);
            scrollPollTimer = null;
        }
        if (restCountdownTimer) {
            clearInterval(restCountdownTimer);
            restCountdownTimer = null;
        }
    }

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

    function extractJobIdFromRow(d) {
        if (!d || typeof d !== 'object') return '';
        return cleanStr(
            d.jobId ||
            d['职位ID'] ||
            d.encryptJobId ||
            (d.zpData && d.zpData.jobInfo && d.zpData.jobInfo.encryptId) ||
            (d.jobInfo && d.jobInfo.encryptId) ||
            (d.jobDetail && d.jobDetail.zpData && d.jobDetail.zpData.jobInfo && d.jobDetail.zpData.jobInfo.encryptId)
        );
    }

    function normalizeCompanyNameForMatch(name) {
        return cleanStr(name).replace(/[·.()\uff08\uff09\s]/g, '').toLowerCase();
    }

    function isCompanyBlacklisted(companyName) {
        if (!companyName || blacklistedCompanies.size === 0) return false;
        const raw = cleanStr(companyName);
        const norm = normalizeCompanyNameForMatch(raw);
        if (!norm) return false;
        if (blacklistedCompanies.has(raw) || blacklistedCompanies.has(norm)) return true;
        for (const blk of blacklistedCompanies) {
            if (blk.length >= 2 && (norm === blk || norm.includes(blk) || blk.includes(norm))) {
                return true;
            }
        }
        return false;
    }

    function loadCache(callback) {
        chrome.storage.local.get(['boss_scraped_v2', 'boss_single_details', 'blacklisted_companies'], (res) => {
            scrapedData = Array.isArray(res.boss_scraped_v2) ? res.boss_scraped_v2 : [];
            const idSet = new Set();
            scrapedData.forEach(d => {
                const id = extractJobIdFromRow(d);
                if (id) idSet.add(id);
            });
            if (Array.isArray(res.boss_single_details)) {
                res.boss_single_details.forEach(d => {
                    const id = extractJobIdFromRow(d);
                    if (id) idSet.add(id);
                });
            }
            scrapedIds = idSet;

            const blkSet = new Set();
            if (Array.isArray(res.blacklisted_companies)) {
                res.blacklisted_companies.forEach(c => {
                    const name = typeof c === 'string' ? c : (c && c.companyName ? c.companyName : '');
                    const n = normalizeCompanyNameForMatch(name);
                    if (n) blkSet.add(n);
                });
            }
            blacklistedCompanies = blkSet;

            // 尝试静默合并本地看板服务的黑名单（不阻塞主流程）
            fetch('http://localhost:3000/api/blacklist')
                .then(r => r.json())
                .then(data => {
                    const list = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : (Array.isArray(data?.companies) ? data.companies : []));
                    list.forEach(item => {
                        const name = typeof item === 'string' ? item : (item?.companyName || item?.name || '');
                        const n = normalizeCompanyNameForMatch(name);
                        if (n) blacklistedCompanies.add(n);
                    });
                })
                .catch(() => {});

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
        }
    }

    function notifyPopupStatus(statusText) {
        try {
            chrome.runtime.sendMessage({
                action: 'boss_update_status',
                isRunning,
                status: statusText
            }).catch(() => {});
        } catch (e) {}
    }

    function notifyPopupCount() {
        try {
            chrome.runtime.sendMessage({
                action: 'boss_update_count',
                count: scrapedData.length
            }).catch(() => {});
        } catch (e) {}
    }

    // ==========================================
    // 风控/验证码检测与紧急熔断机制
    // ==========================================
    function detectRiskControlDOM() {
        const href = location.href || '';
        if (
            href.includes('/web/user/safe/verify-slider') ||
            href.includes('security-check') ||
            href.includes('/unsafe')
        ) {
            return '当前页面已跳转至安全验证页';
        }

        const riskSelectors = [
            '.dialog-account-safe',
            '#zp-verify-slider',
            '.verify-slider-container',
            '.geetest_panel_box',
            '.geetest_wind',
            'iframe[src*="verify-slider"]',
            'iframe[src*="captcha"]'
        ];
        for (const sel of riskSelectors) {
            const el = document.querySelector(sel);
            if (el && (el.offsetWidth > 0 || el.offsetHeight > 0)) {
                return '检测到安全验证/滑块弹窗';
            }
        }

        const dialogWrap = document.querySelector('.dialog-wrap, .boss-dialog, .zp-dialog');
        if (dialogWrap && (dialogWrap.offsetWidth > 0 || dialogWrap.offsetHeight > 0)) {
            const txt = dialogWrap.textContent || '';
            if (/安全验证|行为验证|访问过于频繁|请完成.*验证|异常访问/.test(txt)) {
                return '检测到风控验证弹窗';
            }
        }
        return null;
    }

    function triggerRiskControlCircuitBreaker(reason) {
        if (!isRunning && !isWaitingForDetail) return;
        isRunning = false;
        isWaitingForDetail = false;
        currentProcessingJobId = null;
        currentStepToken++;
        clearAllTimers();

        const msg = `🚨 风控熔断: ${reason || '检测到验证请求'}，已自动暂停！`;
        console.warn('[Boss Scraper]', msg);
        notifyPopupStatus(msg);
        showToast(`${msg} 请手动完成验证并休息几分钟后再继续。`, 8000, '#ef4444');
    }

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'boss_start') {
                isAutoScroll = request.autoScroll !== false;
                isSkipScraped = request.skipScraped !== false;
                isListOnlyMode = request.listOnly === true;
                if (!isRunning) {
                    sessionDetailClickCount = 0;
                    nextDeepCooldownLimit = getRandomInt(50, 65);
                    jobsScrapedSinceRest = 0;
                    nextRestLimit = getRandomInt(8, 14);
                    loadCache(() => {
                        startScraping();
                    });
                }
            } else if (request.action === 'boss_stop') {
                isRunning = false;
                isWaitingForDetail = false;
                currentProcessingJobId = null;
                currentStepToken++;
                clearAllTimers();
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

    function handleInterceptedEventPayload(payload) {
        if (!payload || !payload.type) return;

        if (payload.type === 'BOSS_RISK_CONTROL') {
            const info = payload.data || {};
            triggerRiskControlCircuitBreaker(info.message || `接口风控码 ${info.code}`);
            return;
        }

        if (payload.type === 'BOSS_JOB_LIST') {
            const data = payload.data;
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
        } else if (payload.type === 'BOSS_JOB_DETAIL') {
            const data = payload.data;
            const jobInfo = data.jobInfo || (data.zpData && data.zpData.jobInfo) || (data.data && data.data.jobInfo) || {};
            const jobId = cleanStr(jobInfo.encryptId);
            if (jobId) {
                interceptedDetailJobs.set(jobId, data);
            }

            // 只有当正在等待当前卡片的详情，且拦截到的 jobId 与当前正在处理的卡片 ID 完全匹配时，才触发下一步
            if (isRunning && isWaitingForDetail && jobId && jobId === currentProcessingJobId) {
                onDetailApiCaptured(data);
            }
        }
    }

    // 监听来自 boss_interceptor.js 的隐蔽 CustomEvent 通道
    window.addEventListener('__zp_ext_bridge__', (event) => {
        if (!event || !event.detail) return;
        try {
            const payload = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
            handleInterceptedEventPayload(payload);
        } catch (e) {}
    });

    // 保留对旧版 message 的兼容
    window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data || !event.data.type) return;
        handleInterceptedEventPayload(event.data);
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

        row.jobId = jobId;
        row['职位ID'] = row['职位ID'] || jobId;

        const existingIndex = scrapedData.findIndex(d => extractJobIdFromRow(d) === jobId);
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

    function completeCurrentJob(jobId, row, logMsg) {
        if (!isRunning || !isWaitingForDetail) return false;
        if (currentProcessingJobId && jobId !== currentProcessingJobId) return false;

        // 立即锁定当前步骤状态，防止后续异步响应（如二次点击 XHR 或超时定时器）重复触发 scheduleNextJob 造成跳卡
        isWaitingForDetail = false;
        currentProcessingJobId = null;
        currentStepToken++;
        clearAllTimers();

        sessionProcessedIds.add(jobId);
        upsertData(jobId, row, () => {
            if (logMsg) {
                console.log(logMsg);
            }
            scheduleNextJob();
        });
        return true;
    }

    function onDetailApiCaptured(json) {
        if (!isRunning || !isWaitingForDetail) return;

        const data = json.zpData || json.data || json;
        if (!data || !data.jobInfo) {
            return;
        }

        const job = data.jobInfo || {};
        const jobId = cleanStr(job.encryptId) || currentProcessingJobId;

        if (!jobId || (currentProcessingJobId && jobId !== currentProcessingJobId)) {
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
        row['职位ID'] = jobId;
        row['职位名称'] = row['职位名称'] || cleanStr(job.jobName) || '';
        row.platform = 'boss';
        row.dataSource = 'boss_scraped_v2';
        row['平台'] = 'boss';
        row['数据来源'] = 'boss_scraped_v2';

        completeCurrentJob(
            jobId,
            row,
            `✅ [已更新 ${scrapedData.length + (scrapedIds.has(jobId) ? 0 : 1)}] ${job.jobName || ''} | ${job.salaryDesc || ''}`
        );
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
                        '平台': 'boss',
                        'platform': 'boss',
                        'sourcePlatform': 'Boss直聘',
                        '数据来源': 'boss_single_details_company_card',
                        'dataSource': 'boss_single_details_company_card',
                        '抓取时间': row['抓取时间'] || new Date().toLocaleString(),
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

                // 单独推送职位详情数据 到本地服务（同时挂载独立的纯净企业卡片数据 companyCard，供服务端写入 Company.rawData3）
                const rowToSync = {
                    ...row,
                    companyCard: currentCompData
                };

                fetch('http://localhost:3000/api/job-details', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify([rowToSync])
                }).catch(err => {
                    console.log('[Boss Scraper] Local server single detail sync failed:', err);
                });

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
    function showToast(msg, duration = 3000, bgColor = '#00c2b3') {
        const div = document.createElement('div');
        div.textContent = msg;
        div.style.cssText = `
            position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
            background: ${bgColor}; color: white; padding: 12px 24px;
            border-radius: 8px; z-index: 9999999; font-size: 15px; font-weight: bold; pointer-events: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2); transition: opacity 0.5s;
        `;
        document.body.appendChild(div);
        setTimeout(() => {
            div.style.opacity = '0';
            setTimeout(() => div.remove(), 500);
        }, duration);
    }

    // 拟人化点击：计算目标元素真实矩形区域内的随机坐标，并拆分移入、按压(mousedown)与抬起(mouseup/click)的时间间隔
    function simulateRealClick(element, preventLinkNav = false) {
        if (!element) return;
        let preventNavHandler = null;
        if (preventLinkNav) {
            preventNavHandler = (e) => {
                e.preventDefault();
            };
            window.addEventListener('click', preventNavHandler, true);
        }

        let clientX = getRandomInt(180, 420);
        let clientY = getRandomInt(220, 560);
        try {
            const rect = element.getBoundingClientRect();
            if (rect && rect.width > 4 && rect.height > 4) {
                const offsetX = Math.floor(rect.width * (0.28 + Math.random() * 0.44));
                const offsetY = Math.floor(rect.height * (0.28 + Math.random() * 0.44));
                clientX = Math.max(1, Math.round(rect.left + offsetX));
                clientY = Math.max(1, Math.round(rect.top + offsetY));
            }
        } catch (e) {}

        const screenX = Math.round((window.screenX || 0) + clientX);
        const screenY = Math.round((window.screenY || 0) + clientY + Math.max(0, (window.outerHeight - window.innerHeight)));

        const baseEventInit = {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX,
            clientY,
            screenX,
            screenY
        };

        try {
            ['pointerover', 'mouseover', 'mousemove'].forEach(type => {
                element.dispatchEvent(new MouseEvent(type, { ...baseEventInit, buttons: 0 }));
            });

            const downDelay = getRandomInt(18, 45);
            const pressDuration = getRandomInt(65, 145);

            setTimeout(() => {
                try {
                    ['pointerdown', 'mousedown'].forEach(type => {
                        element.dispatchEvent(new MouseEvent(type, { ...baseEventInit, button: 0, buttons: 1 }));
                    });
                } catch (e) {}

                setTimeout(() => {
                    try {
                        ['pointerup', 'mouseup', 'click'].forEach(type => {
                            element.dispatchEvent(new MouseEvent(type, { ...baseEventInit, button: 0, buttons: 0 }));
                        });
                    } catch (e) {
                        try { element.click(); } catch (err) {}
                    } finally {
                        if (preventNavHandler) {
                            setTimeout(() => window.removeEventListener('click', preventNavHandler, true), 50);
                        }
                    }
                }, pressDuration);
            }, downDelay);
        } catch (e) {
            try { element.click(); } catch (err) {}
            if (preventNavHandler) {
                setTimeout(() => window.removeEventListener('click', preventNavHandler, true), 50);
            }
        }
    }

    function getDetailBoxSignature() {
        const detailBox = document.querySelector('.job-detail-box, .job-detail-container');
        if (!detailBox) return '';
        const jobName = cleanStr(detailBox.querySelector('.job-name, .job-title')?.textContent);
        const descNode = detailBox.querySelector('.job-detail-body .desc, .job-sec-text, .job-detail-section .desc');
        const desc = descNode ? cleanStr(descNode.innerText || descNode.textContent).slice(0, 100) : '';
        return `${jobName}|${desc}`;
    }

    function extractDetailFromDOM(expectedJobId, options = {}) {
        const { requireStrictId = true, preClickSignature = null, expectedJobName = '' } = options;
        const detailBox = document.querySelector('.job-detail-box, .job-detail-container');
        if (!detailBox) return null;

        // 1. 优先从详情区域内所有包含 /job_detail/ 的链接提取当前右侧详情对应的 jobId
        let currentDetailJobId = '';
        let matchedHref = '';
        const detailLinks = detailBox.querySelectorAll('a[href*="/job_detail/"]');
        for (const link of detailLinks) {
            const href = link.getAttribute('href') || '';
            const m = href.match(/\/job_detail\/([^.?#]+)\.html/);
            if (m && m[1]) {
                currentDetailJobId = m[1];
                matchedHref = href;
                break;
            }
        }

        // 2. 其次从明确带有职位 ID 前缀的 ka 属性提取（必须严格匹配前缀，避免把普通 ka 属性值误当作 jobId）
        if (!currentDetailJobId) {
            const kaRules = [
                { sel: 'a[ka^="company_more_job_"]', prefix: 'company_more_job_' },
                { sel: 'a[ka^="popjob_interest_tosign_"]', prefix: 'popjob_interest_tosign_' },
                { sel: 'a[ka^="cpc_job_list_chat_"]', prefix: 'cpc_job_list_chat_' }
            ];
            for (const { sel, prefix } of kaRules) {
                const el = detailBox.querySelector(sel);
                const ka = el ? (el.getAttribute('ka') || '') : '';
                if (ka.startsWith(prefix) && ka.length > prefix.length) {
                    currentDetailJobId = ka.slice(prefix.length);
                    break;
                }
            }
        }

        const jobName = cleanStr(detailBox.querySelector('.job-name, .job-title')?.textContent);
        const descNode = detailBox.querySelector('.job-detail-body .desc, .job-sec-text, .job-detail-section .desc');
        const postDescription = descNode ? cleanMultiLineStr(descNode.innerText || descNode.textContent) : '';

        // 校验右侧详情是否确实对应当前正在处理的卡片（防止误读上一张卡片的 DOM 导致跳过当前卡片）
        if (expectedJobId) {
            if (currentDetailJobId) {
                if (currentDetailJobId !== expectedJobId) {
                    return null;
                }
            } else {
                // 如果右侧详情面板中没有提取到明确的 jobId：
                // 在点击前检查或阶段性检查（requireStrictId=true）时必须返回 null，绝不跳过点击
                if (requireStrictId) {
                    return null;
                }
                // 仅在最终兜底（requireStrictId=false）时：必须满足详情内容已发生变化且职位名一致，才允许读取
                const currentSig = `${jobName}|${cleanStr(postDescription).slice(0, 100)}`;
                if (preClickSignature !== null && currentSig === preClickSignature) {
                    return null;
                }
                if (expectedJobName && jobName && jobName !== expectedJobName) {
                    return null;
                }
            }
        }

        const actualJobId = currentDetailJobId || expectedJobId;
        if (!jobName && !actualJobId) return null;

        const salary = cleanStr(detailBox.querySelector('.job-salary, .salary')?.textContent);
        const tags = Array.from(detailBox.querySelectorAll('.tag-list li, .job-header-info .tag-list span')).map(el => cleanStr(el.textContent)).filter(Boolean);
        const location = tags[0] || '';
        const experience = tags[1] || '';
        const degree = tags[2] || '';

        // 技能标签
        const skillTags = Array.from(detailBox.querySelectorAll('.job-label-list li, .job-keyword-list li')).map(el => cleanStr(el.textContent)).filter(Boolean);

        // HR 与公司信息
        const bossName = cleanStr(detailBox.querySelector('.job-boss-info .name')?.childNodes[0]?.textContent);
        const bossAttr = cleanStr(detailBox.querySelector('.job-boss-info .boss-info-attr')?.textContent);
        let compName = '';
        let bossTitle = '';
        if (bossAttr.includes('·')) {
            const parts = bossAttr.split('·').map(s => s.trim());
            compName = parts[0] || '';
            bossTitle = parts.slice(1).join('·');
        } else {
            compName = bossAttr;
        }

        const activeTime = formatActiveTime(detailBox.querySelector('.job-boss-info .boss-active-time')?.textContent);
        const address = cleanStr(detailBox.querySelector('.job-address-desc, .location-address')?.textContent);

        // 如果从查看更多链接中抓取到了 securityId 和 lid，补全到缓存中
        let securityId = '';
        let lid = '';
        if (matchedHref) {
            try {
                const u = new URL(matchedHref, window.location.origin);
                securityId = u.searchParams.get('securityId') || '';
                lid = u.searchParams.get('lid') || '';
            } catch (e) {}
        }

        let baseRow = interceptedListJobs.has(actualJobId) ? JSON.parse(JSON.stringify(interceptedListJobs.get(actualJobId))) : {};
        if (securityId && !baseRow.securityId) baseRow.securityId = securityId;
        if (lid && !baseRow.lid) baseRow.lid = lid;

        // 构造虚拟详情 JSON，兼容 options.js 和 normalizeJob
        const pseudoDetail = {
            zpData: {
                jobInfo: {
                    encryptId: actualJobId,
                    jobName: jobName || baseRow.jobName || '',
                    salaryDesc: salary || baseRow.salaryDesc || '',
                    experienceName: experience || baseRow.jobExperience || '',
                    degreeName: degree || baseRow.jobDegree || '',
                    locationName: location || baseRow.cityName || '',
                    postDescription: postDescription,
                    showSkills: skillTags.join(','),
                    address: address,
                    securityId: securityId || baseRow.securityId || ''
                },
                bossInfo: {
                    name: bossName || baseRow.bossName || '',
                    title: bossTitle || baseRow.bossTitle || '',
                    activeTimeDesc: activeTime,
                    brandName: compName || baseRow.brandName || ''
                },
                brandComInfo: {
                    brandName: compName || baseRow.brandName || '',
                    scaleName: baseRow.brandScaleName || '',
                    stageName: baseRow.brandStageName || '',
                    industryName: baseRow.brandIndustry || ''
                }
            }
        };

        return {
            ...baseRow,
            jobId: actualJobId,
            platform: 'boss',
            dataSource: 'boss_scraped_v2',
            '平台': 'boss',
            '数据来源': 'boss_scraped_v2',
            '职位ID': actualJobId,
            '职位名称': jobName || baseRow.jobName || '',
            '薪资待遇': salary || baseRow.salaryDesc || '',
            '工作地点': location || [baseRow.cityName, baseRow.areaDistrict, baseRow.businessDistrict].filter(Boolean).join('·') || '',
            '工作经验': experience || baseRow.jobExperience || '',
            '学历要求': degree || baseRow.jobDegree || '',
            '职位描述': postDescription,
            '技能标签': skillTags.join(',') || (baseRow.skills ? baseRow.skills.join(',') : ''),
            '公司名称': compName || baseRow.brandName || '',
            '公司全称': compName || baseRow.brandName || '',
            'HR姓名': bossName || baseRow.bossName || '',
            'HR职位': bossTitle || baseRow.bossTitle || '',
            'HR活跃度': activeTime || '',
            '详细完整地址': address || '',
            '详细地址': address || '',
            '职位链接': `https://www.zhipin.com/job_detail/${actualJobId}.html`,
            jobDetail: pseudoDetail,
            _extracted_from_dom: true
        };
    }

    function extractCardFallback(job) {
        const cardEl = job.el;
        const jobId = job.jobId;
        let baseRow = interceptedListJobs.has(jobId) ? JSON.parse(JSON.stringify(interceptedListJobs.get(jobId))) : {};

        const jobName = cleanStr(cardEl?.querySelector('.job-name')?.textContent) || job.jobName || baseRow.jobName || '';
        const salary = cleanStr(cardEl?.querySelector('.job-salary')?.textContent) || baseRow.salaryDesc || '';
        const tagEls = cardEl ? cardEl.querySelectorAll('.tag-list li') : [];
        const tags = Array.from(tagEls).map(el => cleanStr(el.textContent)).filter(Boolean);
        const exp = tags[0] || baseRow.jobExperience || '';
        const deg = tags[1] || baseRow.jobDegree || '';
        const compName = cleanStr(cardEl?.querySelector('.boss-name')?.textContent) || baseRow.brandName || '';
        const location = cleanStr(cardEl?.querySelector('.company-location')?.textContent) || baseRow.cityName || '';

        return {
            ...baseRow,
            jobId: jobId,
            platform: 'boss',
            dataSource: 'boss_scraped_v2',
            '平台': 'boss',
            '数据来源': 'boss_scraped_v2',
            '职位ID': jobId,
            '职位名称': jobName,
            '薪资待遇': salary,
            '工作地点': location,
            '工作经验': exp,
            '学历要求': deg,
            '公司名称': compName,
            '公司全称': compName,
            '职位链接': `https://www.zhipin.com/job_detail/${jobId}.html`,
            _card_fallback: true
        };
    }

    function collectJobsFromDOM() {
        const seen = new Set();
        const list = [];
        // 兼容不同的卡片包裹元素：.job-card-wrap, .card-area, .job-card-box
        document.querySelectorAll('.job-card-wrap, .card-area, .job-card-box').forEach(cardWrap => {
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
                    const urlObj = new URL(href, window.location.origin);
                    securityId = urlObj.searchParams.get('securityId') || '';
                    lid = urlObj.searchParams.get('lid') || '';
                } catch (e) { }

                if (!seen.has(jobId)) {
                    seen.add(jobId);
                    const jobName = cleanStr(nameLink.textContent);
                    const cardEl = nameLink.closest('.job-card-wrap, .card-area, .job-card-box') || cardWrap;
                    const listObj = interceptedListJobs.get(jobId);
                    const compEl = cardEl.querySelector('.boss-name, .company-name, .company-info a');
                    const companyName = cleanStr(compEl?.textContent) || (listObj && listObj.brandName) || '';
                    list.push({ jobId, securityId, lid, el: cardEl, link: nameLink, jobName, companyName });
                }
            }
        });
        return list;
    }

    // 过滤本轮已处理、历史已抓取（当开启 skipScraped 时）及黑名单企业的职位卡片，避免无效点击触发风控
    function filterPendingJobs(allJobs) {
        let skippedScraped = 0;
        let skippedBlacklisted = 0;
        const pending = [];

        for (const job of allJobs) {
            if (sessionProcessedIds.has(job.jobId)) continue;

            if (isSkipScraped) {
                if (scrapedIds.has(job.jobId)) {
                    sessionProcessedIds.add(job.jobId);
                    skippedScraped++;
                    continue;
                }
                if (job.companyName && isCompanyBlacklisted(job.companyName)) {
                    sessionProcessedIds.add(job.jobId);
                    skippedBlacklisted++;
                    console.log(`[Boss Scraper] 🚫 跳过黑名单企业职位: 【${job.companyName}】${job.jobName}`);
                    continue;
                }
            }
            pending.push(job);
        }

        if (skippedScraped > 0 || skippedBlacklisted > 0) {
            console.log(`[Boss Scraper] 🛡️ 防风控预筛：自动跳过已抓职位 ${skippedScraped} 个，黑名单企业职位 ${skippedBlacklisted} 个`);
        }
        return pending;
    }

    function refreshJobElementsIfDetached(job) {
        if (job.el && job.el.isConnected && job.link && job.link.isConnected) {
            return;
        }
        const liveLink = document.querySelector(`a[href*="/job_detail/${job.jobId}.html"]`);
        if (liveLink) {
            job.link = liveLink;
            job.el = liveLink.closest('.job-card-wrap, .card-area, .job-card-box') || liveLink.parentElement || job.el;
        }
    }

    function startScraping() {
        clearAllTimers();
        isWaitingForDetail = false;
        currentProcessingJobId = null;

        const riskReason = detectRiskControlDOM();
        if (riskReason) {
            triggerRiskControlCircuitBreaker(riskReason);
            return;
        }

        const allJobs = collectJobsFromDOM();
        if (allJobs.length === 0) {
            alert('未发现职位卡片！请先搜索职位，等列表加载完毕后再开始。');
            isRunning = false;
            notifyPopupStatus('出错: 未发现职位卡片');
            return;
        }

        isRunning = true;
        currentList = filterPendingJobs(allJobs);
        currentIndex = 0;

        if (currentList.length === 0) {
            if (isAutoScroll) {
                notifyPopupStatus('当前可见职位均已抓过，正在滚动加载新职位...');
                loadMoreByScroll();
            } else {
                alert('当前可见职位已全部抓取（或已在缓存/黑名单中）！');
                isRunning = false;
                notifyPopupStatus('完毕');
            }
            return;
        }

        processNext();
    }

    function processNext() {
        if (!isRunning) return;

        clearAllTimers();

        const riskReason = detectRiskControlDOM();
        if (riskReason) {
            triggerRiskControlCircuitBreaker(riskReason);
            return;
        }

        if (currentIndex >= currentList.length) {
            isWaitingForDetail = false;
            currentProcessingJobId = null;
            if (isAutoScroll) { loadMoreByScroll(); }
            else { alert('🎉 本批职位全部抓完！'); isRunning = false; notifyPopupStatus('完毕'); }
            return;
        }

        const job = currentList[currentIndex];
        refreshJobElementsIfDetached(job);

        const stepToken = ++currentStepToken;
        isWaitingForDetail = true;
        currentProcessingJobId = job.jobId;

        notifyPopupStatus(`正在处理第 ${currentIndex + 1}/${currentList.length}: ${job.jobName || job.jobId}`);

        // 零点击极速防风控模式：仅提取列表 JSON + 卡片 DOM，不发起任何卡片点击
        if (isListOnlyMode) {
            const listFallbackRow = extractCardFallback(job);
            listFallbackRow._list_only_mode = true;
            completeCurrentJob(
                job.jobId,
                listFallbackRow,
                `🛡️ [仅抓列表模式 ${scrapedData.length + (scrapedIds.has(job.jobId) ? 0 : 1)}] ${job.jobName || ''} | ${listFallbackRow['薪资待遇'] || ''}`
            );
            return;
        }

        try {
            if (job.el && job.el.scrollIntoView) {
                job.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        } catch (e) { }

        waitTimer = setTimeout(() => {
            if (!isRunning || !isWaitingForDetail || stepToken !== currentStepToken) return;

            const riskBeforeClick = detectRiskControlDOM();
            if (riskBeforeClick) {
                triggerRiskControlCircuitBreaker(riskBeforeClick);
                return;
            }

            refreshJobElementsIfDetached(job);

            // 1. 优先使用已拦截的详情数据
            const cachedDetail = interceptedDetailJobs.get(job.jobId);
            if (cachedDetail) {
                console.log(`[Boss Scraper] ⚡ 命中已拦截详情 JSON: ${job.jobId}`);
                onDetailApiCaptured(cachedDetail);
                return;
            }

            // 2. 检查右侧详情是否刚好已经展示了当前职位（必须严格匹配 currentDetailJobId === job.jobId）
            const currentDomDetail = extractDetailFromDOM(job.jobId, { requireStrictId: true });
            if (currentDomDetail && (currentDomDetail['职位名称'] || currentDomDetail['职位描述'])) {
                completeCurrentJob(
                    job.jobId,
                    currentDomDetail,
                    `[Boss Scraper] ⚡ 右侧已展示该职位详情，直接读取 DOM: ${job.jobId}`
                );
                return;
            }

            const preClickSignature = getDetailBoxSignature();

            // 3. 拟人化点击卡片触发右侧详情加载
            const boxEl = (job.el && job.el.matches && job.el.matches('.job-card-box'))
                ? job.el
                : (job.el ? job.el.querySelector('.job-card-box') : null);
            const infoEl = job.el ? job.el.querySelector('.job-info, .job-card-left, .job-card-body') : null;
            const clickTarget = infoEl || boxEl || job.link || job.el;

            sessionDetailClickCount++;
            jobsScrapedSinceRest++;
            simulateRealClick(clickTarget, clickTarget === job.link);

            // 阶段 1：给予充足的随机等待时间 (2.4s ~ 3.3s)，避免短时间高频连击
            waitTimer = setTimeout(() => {
                if (!isRunning || !isWaitingForDetail || stepToken !== currentStepToken) return;

                const riskCheck1 = detectRiskControlDOM();
                if (riskCheck1) {
                    triggerRiskControlCircuitBreaker(riskCheck1);
                    return;
                }

                const checkApi1 = interceptedDetailJobs.get(job.jobId);
                if (checkApi1) {
                    onDetailApiCaptured(checkApi1);
                    return;
                }

                const checkDom1 = extractDetailFromDOM(job.jobId, { requireStrictId: true });
                if (checkDom1 && (checkDom1['职位名称'] || checkDom1['职位描述'])) {
                    completeCurrentJob(
                        job.jobId,
                        checkDom1,
                        `[Boss Scraper] 🎯 阶段1 DOM 捕获成功: ${job.jobId}`
                    );
                    return;
                }

                // 如果右侧面板内容已经发生了变化且职位名一致，直接读取 DOM，不再发起第二次点击
                const relaxedDom1 = extractDetailFromDOM(job.jobId, {
                    requireStrictId: false,
                    preClickSignature,
                    expectedJobName: job.jobName
                });
                if (relaxedDom1 && (relaxedDom1['职位名称'] || relaxedDom1['职位描述'])) {
                    completeCurrentJob(
                        job.jobId,
                        relaxedDom1,
                        `[Boss Scraper] 🎯 阶段1签名变更 DOM 捕获成功: ${job.jobId}`
                    );
                    return;
                }

                // 仅当右侧完全未响应时，才做一次温和补点（移除原先高危的裸 fetch('/wapi/zpgeek/job/detail.json')）
                refreshJobElementsIfDetached(job);
                const retryTarget = boxEl || job.link || job.el;
                simulateRealClick(retryTarget, true);

                // 阶段 2：等待 2.3s ~ 3.0s 后兜底保存
                waitTimer = setTimeout(() => {
                    if (!isRunning || !isWaitingForDetail || stepToken !== currentStepToken) return;

                    const riskCheck2 = detectRiskControlDOM();
                    if (riskCheck2) {
                        triggerRiskControlCircuitBreaker(riskCheck2);
                        return;
                    }

                    const checkApi2 = interceptedDetailJobs.get(job.jobId);
                    if (checkApi2) {
                        onDetailApiCaptured(checkApi2);
                        return;
                    }

                    const finalDom = extractDetailFromDOM(job.jobId, {
                        requireStrictId: false,
                        preClickSignature,
                        expectedJobName: job.jobName
                    });
                    if (finalDom && (finalDom['职位名称'] || finalDom['职位描述'])) {
                        completeCurrentJob(
                            job.jobId,
                            finalDom,
                            `[Boss Scraper] 🎯 最终 DOM 兜底成功: ${job.jobId}`
                        );
                    } else {
                        const cardFallback = extractCardFallback(job);
                        completeCurrentJob(
                            job.jobId,
                            cardFallback,
                            `[Boss Scraper] ⚠️ 详情未返回，使用列表+卡片基础数据兜底保存: ${job.jobId}`
                        );
                    }
                }, getRandomInt(2300, 3000));
            }, getRandomInt(2400, 3300));

        }, getRandomInt(600, 1100));
    }

    function scheduleNextJob() {
        if (!isRunning) return;
        clearAllTimers();
        isWaitingForDetail = false;
        currentProcessingJobId = null;
        const stepToken = ++currentStepToken;

        const riskReason = detectRiskControlDOM();
        if (riskReason) {
            triggerRiskControlCircuitBreaker(riskReason);
            return;
        }

        currentIndex++;

        const proceedAfterDelay = () => {
            if (!isRunning || stepToken !== currentStepToken) return;
            if (currentIndex >= currentList.length) {
                if (isAutoScroll) {
                    loadMoreByScroll();
                } else {
                    alert('🎉 本批职位全部抓完！');
                    isRunning = false;
                    notifyPopupStatus('完毕');
                }
            } else {
                processNext();
            }
        };

        // 如果当前列表已经到底且未开启自动翻页，直接结束，无需等待冷却
        if (currentIndex >= currentList.length && !isAutoScroll) {
            alert('🎉 本批职位全部抓完！');
            isRunning = false;
            notifyPopupStatus('完毕');
            return;
        }

        // 零点击列表模式只需极短间隔
        if (isListOnlyMode) {
            const listDelay = currentIndex >= currentList.length ? getRandomInt(1500, 2500) : getRandomInt(180, 380);
            waitTimer = setTimeout(proceedAfterDelay, listDelay);
            return;
        }

        // 全自动深度冷却续抓：每连续真实点击满 50~65 条，自动进行 90~150 秒深度冷却，随后自动清零继续抓取
        if (sessionDetailClickCount >= nextDeepCooldownLimit) {
            const reachedCount = sessionDetailClickCount;
            sessionDetailClickCount = 0;
            nextDeepCooldownLimit = getRandomInt(50, 65);
            jobsScrapedSinceRest = 0;
            nextRestLimit = getRandomInt(8, 14);

            const cooldownMs = getRandomInt(90000, 150000);
            let remainingSec = Math.ceil(cooldownMs / 1000);

            showToast(`🧊 已连续抓取 ${reachedCount} 条，进入 ${remainingSec}s 深度冷却，倒计时结束后将自动继续！`, 6000, '#0284c7');
            notifyPopupStatus(`🧊 深度冷却中 (${remainingSec}s 后自动续抓)...`);

            restCountdownTimer = setInterval(() => {
                remainingSec--;
                if (remainingSec > 0 && isRunning && stepToken === currentStepToken) {
                    notifyPopupStatus(`🧊 深度冷却中 (${remainingSec}s 后自动续抓)...`);
                } else if (restCountdownTimer) {
                    clearInterval(restCountdownTimer);
                    restCountdownTimer = null;
                }
            }, 1000);

            waitTimer = setTimeout(() => {
                if (restCountdownTimer) {
                    clearInterval(restCountdownTimer);
                    restCountdownTimer = null;
                }
                proceedAfterDelay();
            }, cooldownMs);
            return;
        }

        // 分批疲劳长休眠：每点击 8~14 个职位详情，自动进行一次 15~28 秒的阶段性长休息
        if (jobsScrapedSinceRest >= nextRestLimit) {
            jobsScrapedSinceRest = 0;
            nextRestLimit = getRandomInt(8, 14);
            const restMs = getRandomInt(15000, 28000);
            let remainingSec = Math.ceil(restMs / 1000);

            notifyPopupStatus(`☕ 防风控阶段休眠中 (${remainingSec}s)...`);
            restCountdownTimer = setInterval(() => {
                remainingSec--;
                if (remainingSec > 0 && isRunning && stepToken === currentStepToken) {
                    notifyPopupStatus(`☕ 防风控阶段休眠中 (${remainingSec}s)...`);
                } else if (restCountdownTimer) {
                    clearInterval(restCountdownTimer);
                    restCountdownTimer = null;
                }
            }, 1000);

            waitTimer = setTimeout(() => {
                if (restCountdownTimer) {
                    clearInterval(restCountdownTimer);
                    restCountdownTimer = null;
                }
                proceedAfterDelay();
            }, restMs);
            return;
        }

        if (currentIndex >= currentList.length) {
            const scrollWait = getRandomInt(1800, 3000);
            waitTimer = setTimeout(proceedAfterDelay, scrollWait);
            return;
        }

        // 拟人化阅读节奏：基础 2.6s~5.2s，20% 概率触发一次深读停顿 (+1.5s~3.2s)
        let delay = getRandomInt(2600, 5200);
        if (Math.random() < 0.2) {
            delay += getRandomInt(1500, 3200);
        }
        notifyPopupStatus(`安全休眠 ${(delay / 1000).toFixed(1)}s (距小休 ${Math.max(1, nextRestLimit - jobsScrapedSinceRest)} 条 / 距大休 ${Math.max(1, nextDeepCooldownLimit - sessionDetailClickCount)} 条)`);
        waitTimer = setTimeout(proceedAfterDelay, delay);
    }

    function loadMoreByScroll() {
        if (!isRunning) return;
        clearAllTimers();
        isWaitingForDetail = false;
        currentProcessingJobId = null;
        const stepToken = ++currentStepToken;

        notifyPopupStatus(`正在拟人滚动加载新职位...`);

        let tries = 0;
        let duplicateBatchCount = 0;
        let lastDomCardCount = document.querySelectorAll('.card-area, .job-card-wrap').length;
        scrollSessionInterceptedCount = 0;
        scrollSessionHasNewJobs = false;

        const stepScroll = () => {
            if (!isRunning || stepToken !== currentStepToken) {
                clearAllTimers();
                return;
            }

            const riskReason = detectRiskControlDOM();
            if (riskReason) {
                triggerRiskControlCircuitBreaker(riskReason);
                return;
            }

            tries++;

            // 1. 拟人化随机滚动步长与偶发微幅回滚
            if (Math.random() < 0.15 && window.scrollY > 300) {
                window.scrollBy({ top: -getRandomInt(40, 95), behavior: 'smooth' });
            } else if (tries % 5 === 0) {
                window.scrollBy({ top: getRandomInt(540, 820), behavior: 'smooth' });
            } else {
                window.scrollBy({ top: getRandomInt(260, 510), behavior: 'smooth' });
            }

            // 2. 检测 DOM 中是否已有未被处理（且未在已抓缓存/黑名单中）的新职位卡片
            const pendingJobs = filterPendingJobs(collectJobsFromDOM());
            if (pendingJobs.length > 0) {
                clearAllTimers();
                const wait = getRandomInt(1600, 2800);
                notifyPopupStatus(`发现 ${pendingJobs.length} 个新职位，等待 ${(wait / 1000).toFixed(1)}s`);
                waitTimer = setTimeout(() => {
                    if (isRunning && stepToken === currentStepToken) {
                        startScraping();
                    }
                }, wait);
                return;
            }

            // 2.5 检测页面是否刚刚追加了一批全是重复 ID 的卡片（Boss 推荐流常见现象：整页 15~30 张全是前面出现过的重复卡片）
            const currentDomCardCount = document.querySelectorAll('.card-area, .job-card-wrap').length;
            if (currentDomCardCount > lastDomCardCount) {
                lastDomCardCount = currentDomCardCount;
                duplicateBatchCount++;
                if (duplicateBatchCount <= 6) {
                    tries = Math.min(tries, 4);
                    const allCards = document.querySelectorAll('.card-area, .job-card-wrap');
                    const lastCard = allCards[allCards.length - 1];
                    if (lastCard && lastCard.scrollIntoView) {
                        try { lastCard.scrollIntoView({ behavior: 'smooth', block: 'end' }); } catch (e) {}
                    }
                    notifyPopupStatus(`跳过新加载的重复卡片批次 (${duplicateBatchCount})，继续下滑...`);
                    scrollPollTimer = setTimeout(stepScroll, getRandomInt(1000, 1750));
                    return;
                }
            }

            // 3. 网络延迟保护：如果滚动期间刚刚拦截到了含有新职位的 JSON 响应
            if (scrollSessionHasNewJobs && (Date.now() - lastJobListInterceptedTime < 3800)) {
                notifyPopupStatus(`已拦截新职位数据，等待页面渲染... (${tries})`);
                if (tries > 8) tries = 8;
                scrollPollTimer = setTimeout(stepScroll, getRandomInt(950, 1650));
                return;
            }

            // 4. 滚动至第 12 次时做一次触底滚动以激活 IntersectionObserver
            if (tries === 12) {
                window.scrollTo({ top: document.body.scrollHeight - getRandomInt(20, 120), behavior: 'smooth' });
            }

            // 5. 触底与结束判定
            const isBottom = (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 150);
            if (tries >= 16 && (isBottom || lastJobListHasMore === false || tries >= 22)) {
                clearAllTimers();
                console.log(`[Boss Scraper] 全部抓取完成判定触发: 经过 ${tries} 次滚动未再发现待抓新职位卡片`);
                alert(`🎉 抓取完毕！页面已触底且未发现更多待抓新职位，共缓存 ${scrapedData.length} 条数据。`);
                isRunning = false;
                notifyPopupStatus('完毕');
                return;
            }

            scrollPollTimer = setTimeout(stepScroll, getRandomInt(900, 1750));
        };

        scrollPollTimer = setTimeout(stepScroll, getRandomInt(600, 1100));
    }

    // === 详情页自动抓取逻辑（支持无 URL 参数的隐蔽自动关闭） ===
    if (location.href.includes('/job_detail/')) {
        const initDelay = getRandomInt(2100, 3400);
        setTimeout(() => {
            const riskReason = detectRiskControlDOM();
            if (riskReason) {
                showToast(`🚨 ${riskReason}，已跳过自动提取`, 6000, '#ef4444');
                return;
            }

            scrapeSinglePage();

            const scheduleTabClose = (delayMs) => {
                const finalDelay = (delayMs && delayMs > 0) ? delayMs : getRandomInt(2500, 4800);
                setTimeout(() => {
                    window.close();
                    try {
                        chrome.runtime.sendMessage({ action: 'close_current_tab' }).catch(() => {});
                    } catch (e) { }
                }, finalDelay);
            };

            // 1. 检查由 boss_interceptor.js 在 document_start 剥离并存入 sessionStorage 的自动关闭配置
            let storedAutoCloseDelay = null;
            try {
                storedAutoCloseDelay = sessionStorage.getItem('__zp_ac_delay__');
                if (storedAutoCloseDelay) {
                    sessionStorage.removeItem('__zp_ac_delay__');
                }
            } catch (e) {}

            if (storedAutoCloseDelay) {
                scheduleTabClose(parseInt(storedAutoCloseDelay, 10));
            } else if (location.href.includes('auto_close=1')) {
                const match = location.href.match(/[?&]close_delay=(\d+)/);
                const closeDelay = match ? parseInt(match[1], 10) : getRandomInt(2500, 4800);
                scheduleTabClose(closeDelay);
            } else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                // 2. 向 background 查询当前标签页是否由 BOSS_OPEN_TAB 后台打开
                try {
                    chrome.runtime.sendMessage({ action: 'check_boss_auto_close' }, (resp) => {
                        if (chrome.runtime.lastError) return;
                        if (resp && resp.autoClose) {
                            scheduleTabClose(resp.closeDelay);
                        }
                    });
                } catch (e) {}
            }
        }, initDelay);
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

                // 1. 优先写入扩展本地存储 blacklisted_companies，确保抓取列表时也能立即跳过这些黑名单企业
                chrome.storage.local.get(['blacklisted_companies'], (storageRes) => {
                    const existing = Array.isArray(storageRes.blacklisted_companies) ? storageRes.blacklisted_companies : [];
                    const mergedSet = new Set(existing);
                    selected.forEach(s => {
                        if (s.companyName) {
                            mergedSet.add(s.companyName);
                            const norm = normalizeCompanyNameForMatch(s.companyName);
                            if (norm) blacklistedCompanies.add(norm);
                        }
                    });
                    chrome.storage.local.set({ blacklisted_companies: Array.from(mergedSet) });
                });

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
                        alert(`✅ 成功将 ${selected.length} 家企业加入黑名单（已同步至插件本地缓存与看板服务）！`);
                        closeModal();
                    } else {
                        alert(`✅ 已将 ${selected.length} 家企业写入插件本地黑名单（本地看板服务返回: ${res?.error || '异常'}）`);
                        closeModal();
                    }
                } catch (err) {
                    alert(`✅ 已将 ${selected.length} 家企业写入插件本地黑名单！\n（注：本地看板 http://localhost:3000 未开启，仅保存在插件本地）`);
                    closeModal();
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
