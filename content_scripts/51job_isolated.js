(function () {
    'use strict';

    const BRIDGE_EVENT_NAME = '__51job_ext_bridge__';

    function decodeHtmlEntities(str) {
        if (!str || typeof str !== 'string') return '';
        return str
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/&mdash;/gi, '—')
            .replace(/&ldquo;/gi, '“')
            .replace(/&rdquo;/gi, '”');
    }

    function cleanStr(str) {
        if (str == null) return '';
        if (Array.isArray(str)) str = str.join(' / ');
        return decodeHtmlEntities(String(str))
            .replace(/[\r\n\t]+/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .replace(/"/g, '""')
            .trim();
    }

    function cleanMultiLineStr(str) {
        if (str == null) return '';
        if (Array.isArray(str)) str = str.join('\n');
        return decodeHtmlEntities(String(str))
            .replace(/\r\n/g, '\n')
            .replace(/"/g, '""')
            .trim();
    }

    function normalizeCompanyNameForMatch(name) {
        return cleanStr(name).replace(/[·.()\uff08\uff09\s]/g, '').toLowerCase();
    }

    // ==========================================
    // 列表页 (Master) 与 详情页 (Detail) 判定
    // ==========================================
    const isMaster = window.self === window.top && window.location.href.includes('we.51job.com');
    const isCompanyPage = /\/co[a-zA-Z0-9_-]+\.html/i.test(window.location.href) || /\/all\/co/i.test(window.location.href);
    const isJobDetail = window.location.href.includes('jobs.51job.com') && /\/\d+\.html/i.test(window.location.href) && !isCompanyPage;

    // ==========================================
    // 详情页 (Detail) 独立单页抓取与新标签页拦截逻辑
    // ==========================================
    if (isJobDetail && !isMaster) {
        let interceptedDetailData = null;
        let interceptedCompanyData = null;
        let hasScrapedThisPage = false;

        // 页面提示 Toast
        function showToast(msg) {
            const div = document.createElement('div');
            div.textContent = msg;
            div.style.cssText = `
                position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
                background: #ff6000; color: white; padding: 12px 24px;
                border-radius: 8px; z-index: 9999999; font-size: 15px; font-weight: bold; pointer-events: none;
                box-shadow: 0 4px 12px rgba(0,0,0,0.25); transition: opacity 0.5s;
            `;
            const container = document.body || document.documentElement;
            if (container) {
                container.appendChild(div);
                setTimeout(() => {
                    div.style.opacity = '0';
                    setTimeout(() => div.remove(), 500);
                }, 3000);
            }
        }

        function closeDetailTabSafely(delayMs) {
            const finalDelay = (delayMs && delayMs > 0) ? delayMs : (Math.floor(Math.random() * (4500 - 2000 + 1)) + 2000);
            setTimeout(() => {
                try { chrome.runtime.sendMessage({ action: '51JOB_CLOSE_TAB', isMaster: false }); } catch (e) {}
                try { chrome.runtime.sendMessage({ action: 'close_current_tab' }); } catch (e) {}
                try { window.close(); } catch (e) {}
            }, finalDelay);
        }

        // 轮询检查页面是否有“暂停招聘”或“安全验证”
        let checkCount = 0;
        const checkTimer = setInterval(() => {
            checkCount++;
            const bodyText = document.body.innerText || "";
            if (bodyText.includes("很抱歉，您选择的公司目前已经暂停招聘") || bodyText.includes("很抱歉，您选择的职位目前已经暂停招聘") || bodyText.includes("职位已停止招聘") || bodyText.includes("职位已关闭") || bodyText.includes("职位已下线")) {
                clearInterval(checkTimer);
                const match = window.location.href.match(/\/(\d+)\.html/);
                const jobId = match ? match[1] : null;
                console.log(`[51job Detail] 检测到职位/公司已暂停招聘: ${jobId}`);
                
                chrome.runtime.sendMessage({ 
                    action: '51JOB_DATA_EXTRACTED', 
                    data: { type: '51JOB_JOB_CLOSED', jobId: jobId } 
                }).catch(() => {});

                // 检查是否应自动关闭标签页
                let storedDelay = null;
                try {
                    storedDelay = sessionStorage.getItem('__51job_ac_delay__');
                    if (storedDelay) sessionStorage.removeItem('__51job_ac_delay__');
                } catch (e) {}
                if (storedDelay || window.location.href.includes('auto_close=1')) {
                    closeDetailTabSafely(1000);
                } else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                    try {
                        chrome.runtime.sendMessage({ action: 'check_51job_auto_close' }, (resp) => {
                            if (resp && resp.autoClose) closeDetailTabSafely(1000);
                        });
                    } catch (e) {}
                }
            } else if (bodyText.includes("Access Verification") || bodyText.includes("Please slide to complete the verification")) {
                clearInterval(checkTimer);
                const match = window.location.href.match(/\/(\d+)\.html/);
                const jobId = match ? match[1] : null;
                console.log(`[51job Detail] 检测到安全验证 (Access Verification)！: ${jobId}`);
                showToast("⚠️ 51job提示安全验证，请先在页面完成滑动验证");
                
                chrome.runtime.sendMessage({ 
                    action: '51JOB_DATA_EXTRACTED', 
                    data: { type: '51JOB_CAPTCHA_DETECTED', jobId: jobId } 
                }).catch(() => {});
            } else if (checkCount > 15) {
                clearInterval(checkTimer);
            }
        }, 500);

        function requestApiCache() {
            try {
                window.dispatchEvent(new CustomEvent(BRIDGE_EVENT_NAME, { detail: JSON.stringify({ type: '51JOB_REQUEST_API_CACHE' }) }));
            } catch (e) {}
            try {
                window.postMessage({ type: '51JOB_REQUEST_API_CACHE' }, '*');
            } catch (e) {}
        }

        // 主动向拦截器请求已缓存的 API 数据
        requestApiCache();

        function handleDetailMessagePayload(data) {
            if (!data) return;
            if (data.type === '51JOB_DETAIL_DATA') {
                interceptedDetailData = data.data;
                chrome.runtime.sendMessage({ action: '51JOB_DATA_EXTRACTED', data: data }).catch(() => {});
                
                if (data.error === "BLOCKED_BY_CAPTCHA") {
                    console.log("⚠️ [51job Detail] 遇到验证码或安全拦截，保留当前页面以便手动验证。");
                    return;
                }

                // 尝试执行独立保存
                const isAutoTab = (window.self !== window.top);
                scrapeSinglePage(isAutoTab);

                // 自动关闭标签页逻辑
                let storedDelay = null;
                try {
                    storedDelay = sessionStorage.getItem('__51job_ac_delay__');
                    if (storedDelay) sessionStorage.removeItem('__51job_ac_delay__');
                } catch (e) {}

                if (storedDelay) {
                    closeDetailTabSafely(parseInt(storedDelay, 10));
                } else if (window.location.href.includes('auto_close=1')) {
                    const match = window.location.href.match(/[?&]close_delay=(\d+)/);
                    const closeDelay = match ? parseInt(match[1], 10) : (Math.floor(Math.random() * (4500 - 2000 + 1)) + 2000);
                    closeDetailTabSafely(closeDelay);
                } else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                    try {
                        chrome.runtime.sendMessage({ action: 'check_51job_auto_close' }, (resp) => {
                            if (resp && resp.autoClose) {
                                closeDetailTabSafely(resp.closeDelay);
                            }
                        });
                    } catch (e) {}
                }
            } else if (data.type === '51JOB_COMPANY_DATA') {
                interceptedCompanyData = data.data;
                chrome.runtime.sendMessage({ action: '51JOB_DATA_EXTRACTED', data: data }).catch(() => {});
                if (hasScrapedThisPage) {
                    const isAutoTab = (window.self !== window.top);
                    scrapeSinglePage(isAutoTab);
                }
            } else if (data.type === '51JOB_API_CACHE_RETURNED') {
                if (data.detailData) interceptedDetailData = data.detailData;
                else if (data.data && data.data.detailJobInfo) interceptedDetailData = data.data;
                if (data.companyData) interceptedCompanyData = data.companyData;
            }
        }

        window.addEventListener(BRIDGE_EVENT_NAME, (event) => {
            try {
                const data = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
                handleDetailMessagePayload(data);
            } catch (e) {}
        });

        window.addEventListener('message', (event) => {
            if (event.data) handleDetailMessagePayload(event.data);
        });

        // 监听 Popup 手动触发指令
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === '51job_scrape_single') {
                scrapeSinglePage(false);
                sendResponse({ success: true });
            } else if (request.action === '51job_get_status') {
                sendResponse({ isRunning: false, status: '详情页就绪' });
            }
        });

        // === 独立职位详情提取函数 (API拦截优先 + DOM兜底 双保险) ===
        function scrapeSinglePage(isSilent = false) {
            try {
                const urlMatch = window.location.href.match(/\/(\d+)\.html/);
                const jobId = (interceptedDetailData && interceptedDetailData.detailJobInfo && interceptedDetailData.detailJobInfo.jobId)
                    || (urlMatch ? urlMatch[1] : null);

                if (!jobId) {
                    console.log('[51job Detail] 当前页面未能解析到纯数字 jobId，跳过抓取');
                    return;
                }

                const d = (interceptedDetailData && interceptedDetailData.detailJobInfo) || {};
                const hr = (interceptedDetailData && interceptedDetailData.jobHrInfo) || {};
                const co = (interceptedCompanyData && interceptedCompanyData.coinfo) || {};
                const lic = (interceptedCompanyData && interceptedCompanyData.license) || {};
                const sesame = (interceptedCompanyData && interceptedCompanyData.sesameLabelList) || [];

                // DOM 兜底辅助提取
                const domTitle = cleanStr(document.querySelector('.tHeader.tHjob .jTitle h1')?.innerText || document.querySelector('.jTitle h1')?.innerText || document.querySelector('h1[title]')?.getAttribute('title') || document.querySelector('h1')?.innerText);
                const domSalary = cleanStr(document.querySelector('.tHeader.tHjob .jTitle strong')?.innerText || document.querySelector('.jTitle strong')?.innerText);
                const domMsgSpan = document.querySelectorAll('.tHeader.tHjob .msg.ltype span');
                let domCity = '', domExp = '', domDegree = '';
                if (domMsgSpan.length >= 3) {
                    domCity = cleanStr(domMsgSpan[0].innerText);
                    domExp = cleanStr(domMsgSpan[1].innerText);
                    domDegree = cleanStr(domMsgSpan[2].innerText);
                } else {
                    const ltypeText = cleanStr(document.querySelector('.tHeader.tHjob .msg.ltype')?.innerText || '');
                    const parts = ltypeText.split(/[\s·|]+/).filter(Boolean);
                    if (parts.length >= 1) domCity = parts[0];
                    if (parts.length >= 2) domExp = parts[1];
                    if (parts.length >= 3) domDegree = parts[2];
                }
                const domDesc = cleanMultiLineStr(document.querySelector('.job_msg')?.innerText || document.querySelector('.bmsg.job_msg')?.innerText || document.querySelector('.job-detail')?.innerText);
                const domCompName = cleanStr(document.querySelector('a.com_name')?.innerText || document.querySelector('.com_name')?.innerText || document.querySelector('.cname')?.innerText);
                const domAddress = cleanStr(document.querySelector('.job-address')?.innerText || document.querySelector('.bmsg.inbox .bname')?.parentElement?.innerText || document.querySelector('.bmsg.inbox')?.innerText);
                const domTags = Array.from(document.querySelectorAll('.tBorderTop_box .bmsg .sp4, .job-keyword-list li, .t1 span')).map(el => cleanStr(el.innerText)).filter(Boolean).join(',');
                const domWelfare = Array.from(document.querySelectorAll('.tHeader.tHjob .t2 span, .job-tags span')).map(el => cleanStr(el.innerText)).filter(Boolean).join(',');

                const today = new Date();
                const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

                const row = {
                    '职位ID': String(jobId),
                    '平台': '51job',
                    '数据来源': '51job_single_details',
                    'platform': '51job',
                    'dataSource': '51job_single_details',
                    '职位名称': cleanStr(d.jobName) || domTitle,
                    '招聘状态': d.term === '0' ? '招聘中' : '招聘中',
                    '薪资待遇': cleanStr(d.provideSalaryString) || domSalary,
                    '工作地点': cleanStr(d.jobAreaLevelDetail ? [d.jobAreaLevelDetail.provinceString, d.jobAreaLevelDetail.cityString, d.jobAreaLevelDetail.districtString].filter(Boolean).join(' ') : '') || domCity,
                    '工作经验': cleanStr(d.workYearString) || domExp,
                    '学历要求': cleanStr(d.degreeString) || domDegree,
                    '职位描述': cleanMultiLineStr(d.jobDescribe) || domDesc,
                    '技能标签': (d.jobKeywordList && d.jobKeywordList.length > 0) ? d.jobKeywordList.map(k => cleanStr(k.wordText)).filter(Boolean).join(',') : (cleanStr(d.jobKeywordString) || domTags),
                    'HR姓名': cleanStr(hr.hrName) || cleanStr(document.querySelector('.jobHrInfo .hrName, .hr-name')?.innerText),
                    'HR职位': cleanStr(hr.hrPosition) || cleanStr(document.querySelector('.jobHrInfo .hrPosition, .hr-position')?.innerText),
                    'HR活跃度': cleanStr(hr.activeStatus || hr.todayActive) || cleanStr(document.querySelector('.jobHrInfo .activeStatus, .active-status')?.innerText),
                    'HR_ID': cleanStr(hr.hrUid),
                    'HR标签': Array.isArray(hr.hrLabels) ? hr.hrLabels.map(cleanStr).join(',') : '',
                    '公司名称': cleanStr(d.companyName || d.coName || co.coname) || domCompName,
                    '公司全称': cleanStr(lic.businessName || co.coname || d.companyName) || domCompName,
                    '公司行业': cleanStr(d.industryType1String || d.coIndustryText || co.indtype1),
                    '公司规模': cleanStr(d.companySizeString || co.cosize),
                    '公司福利': cleanStr(d.welfare) || (d.jobWelfareAllDataList ? d.jobWelfareAllDataList.map(w => cleanStr(w.wordText)).filter(Boolean).join(',') : '') || domWelfare,
                    '法定代表人': cleanStr(lic.operName),
                    '成立日期': cleanStr(lic.startAt),
                    '企业类型': cleanStr(d.companyTypeString || co.cotype),
                    '经营状态': cleanStr(lic.manageState || '在业/存续'),
                    '注册资金': cleanStr(lic.registCapi),
                    '企业资质标签': sesame.map(s => cleanStr(s.labelName)).filter(Boolean).join(','),
                    '公司ID': cleanStr(d.coId || co.coid || co.ctmId || d.ctmId),
                    '详细完整地址': cleanStr(d.address || d.companyAddress || co.caddr) || domAddress,
                    '详细工作地址': cleanStr(d.address || d.companyAddress || co.caddr) || domAddress,
                    '页面更新时间': cleanStr(d.issueDate),
                    '发布时间': cleanStr(d.issueDate),
                    '抓取时间': new Date().toLocaleString(),
                    '创建时间': todayStr,
                    '更新时间': todayStr,
                    '抓取源URL': window.location.href,
                    'raw_detail_json': interceptedDetailData || {},
                    'raw_company_json': interceptedCompanyData || {}
                };

                // 保存到 51job_single_details 影子库 (修复：恢复本地存储写入)
                chrome.storage.local.get(['51job_single_details', '51job_companies_scraped'], (res) => {
                    const list = Array.isArray(res['51job_single_details']) ? res['51job_single_details'] : [];
                    const idx = list.findIndex(item => (item['职位ID'] || item.jobId) === String(jobId));
                    if (idx >= 0) {
                        row['创建时间'] = list[idx]['创建时间'] || todayStr;
                        list[idx] = row;
                    } else {
                        list.push(row);
                    }

                    // 保存企业全景数据
                    let compList = Array.isArray(res['51job_companies_scraped']) ? res['51job_companies_scraped'] : [];
                    const cId = row['公司ID'];
                    const cFullName = row['公司全称'] || row['公司名称'];

                    let currentCompData = null;
                    if (cId || cFullName) {
                        const compData = {
                            '公司ID': cId || '',
                            '公司全称': cFullName || '',
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
                            '企业资质标签': row['企业资质标签'] || '',
                            '平台': '51job',
                            'platform': '51job',
                            'sourcePlatform': '51job',
                            '数据来源': '51job_single_details_company_card',
                            'dataSource': '51job_single_details_company_card',
                            '更新时间': new Date().toLocaleString(),
                            '抓取时间': row['抓取时间'] || new Date().toLocaleString()
                        };
                        currentCompData = compData;

                        const cIdx = compList.findIndex(c => {
                            const cidMatch = cId && (String(c['公司ID']) === String(cId) || (c.coinfo && String(c.coinfo.coid || c.coinfo.ctmId) === String(cId)));
                            const cnameMatch = !cId && ((c['公司全称'] && c['公司全称'] === cFullName) || (c['公司名称'] && c['公司名称'] === cFullName));
                            return cidMatch || cnameMatch;
                        });

                        if (cIdx >= 0) {
                            compList[cIdx] = { ...compList[cIdx], ...compData };
                        } else {
                            compData['创建时间'] = compData['更新时间'];
                            compList.push(compData);
                        }
                    }

                    // 写入扩展程序本地缓存
                    chrome.storage.local.set({
                        '51job_single_details': list,
                        '51job_companies_scraped': compList
                    }, () => {
                        console.log(`[51job Detail] 职位详情已保存到 51job_single_details: ${row['职位名称']} (${jobId})`);
                    });

                    const wasAlreadyScraped = hasScrapedThisPage;
                    hasScrapedThisPage = true;
                    if (!isSilent && !wasAlreadyScraped) {
                        showToast('✅ 51job职位详情已自动抓取，关键数据已同步至主库！');
                    } else if (isSilent === false && wasAlreadyScraped) {
                        showToast('✅ 51job职位详情已重新抓取，关键数据已同步至主库！');
                    }
                    console.log(`[51job Detail] 职位详情已成功抓取: ${row['职位名称']} (${jobId})`);

                    // 尝试推送职位详情到本地服务器
                    const rowToSync = {
                        ...row,
                        companyCard: currentCompData
                    };
                    fetch('http://localhost:3000/api/job-details', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify([rowToSync])
                    }).catch(() => {});
                });

            } catch (err) {
                console.error('[51job Detail] 抓取职位详情报错:', err);
                if (!isSilent) {
                    showToast('❌ 51job详情抓取报错: ' + err.message);
                }
            }
        }

        // 页面打开 2 秒后自动执行一次抓取（等待 API 拦截或 DOM 渲染就绪）
        setTimeout(() => {
            if (!hasScrapedThisPage) {
                requestApiCache();
                setTimeout(() => {
                    scrapeSinglePage(window.self !== window.top);
                }, 300);
            }
        }, 2000);

        return; // 详情页执行专属单页逻辑，不执行后面的列表主控逻辑
    }

    if (!isMaster) return;

    // ==========================================
    // 列表页 (Master) 核心控制器
    // ==========================================
    let isRunning = false;
    let shouldStopAfterCurrent = false;
    let isAutoPage = true;
    let openMode = 'iframe';
    let skipScraped = true;
    let isListOnlyMode = false;
    let currentList = [];
    let currentIndex = 0;
    let scrapedData = [];
    let scrapedCompanies = [];
    let scrapedIds = new Set();
    let blacklistedCompanies = new Set();
    let sessionProcessedUrls = new Set();
    let currentWaitingItem = null;
    let waitTimer = null;
    let jobsScrapedSinceRest = 0;
    let nextRestLimit = getRandomInt(8, 14);
    let pageChangeResolver = null;

    function getRandomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

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
        chrome.storage.local.get(['51job_scraped_v2', '51job_companies_scraped', 'blacklisted_companies'], (res) => {
            scrapedData = Array.isArray(res['51job_scraped_v2']) ? res['51job_scraped_v2'] : [];
            scrapedCompanies = Array.isArray(res['51job_companies_scraped']) ? res['51job_companies_scraped'] : [];
            scrapedIds = new Set(scrapedData.map(d => String(d.jobId || d['职位ID'] || '')).filter(Boolean));

            const blkSet = new Set();
            if (Array.isArray(res.blacklisted_companies)) {
                res.blacklisted_companies.forEach(c => {
                    const name = typeof c === 'string' ? c : (c && c.companyName ? c.companyName : '');
                    const n = normalizeCompanyNameForMatch(name);
                    if (n) blkSet.add(n);
                });
            }
            blacklistedCompanies = blkSet;

            // 尝试静默拉取看板黑名单
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
        chrome.storage.local.set({ '51job_scraped_v2': scrapedData }, () => {
            notifyPopupCount();
            if (callback) callback();
        });

        if (newRow) {
            newRow['平台'] = '51job';
            newRow['数据来源'] = '51job_scraped_v2';
            newRow.platform = '51job';
            newRow.dataSource = '51job_scraped_v2';

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
                console.log('[51job Scraper] Local server sync failed:', err);
            });
        }
    }

    function notifyPopupStatus(statusText) {
        try {
            chrome.runtime.sendMessage({ action: '51job_update_status', isRunning, status: statusText }).catch(() => {});
        } catch (e) {}
    }

    function notifyPopupCount() {
        try {
            chrome.runtime.sendMessage({ action: '51job_update_count', count: scrapedData.length }).catch(() => {});
        } catch (e) {}
    }

    // Iframe 管理
    let detailIframe = null;
    function getOrCreateIframe() {
        if (!detailIframe) {
            detailIframe = document.createElement('iframe');
            detailIframe.id = 'job-scraper-detail-iframe';
            detailIframe.style.position = 'fixed';
            detailIframe.style.bottom = '20px';
            detailIframe.style.right = '20px';
            detailIframe.style.width = '600px';
            detailIframe.style.height = '500px';
            detailIframe.style.zIndex = '99999999';
            detailIframe.style.border = '3px solid #ff9800';
            detailIframe.style.borderRadius = '8px';
            detailIframe.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
            detailIframe.style.background = '#fff';
            detailIframe.style.display = 'none';
            document.body.appendChild(detailIframe);
        }
        return detailIframe;
    }

    function handleMasterMessagePayload(eventData) {
        if (!eventData) return;

        // 收到列表数据通知
        if (eventData.type === '51JOB_LIST_DATA') {
            window.__51JOB_LIST_DATA__ = eventData.data;
            if (pageChangeResolver) {
                pageChangeResolver(true);
            }
            return;
        }

        if (eventData.type === '51JOB_COMPANY_DATA' && eventData.data) {
            console.log("🌟 [51job Isolated] 收到公司数据消息:", eventData);
            const coData = eventData.data;
            let coId = eventData.coId;
            if (!coId && coData.coinfo) {
                coId = coData.coinfo.coid || coData.coinfo.ctmId;
            }
            if (coId) {
                const existingIndex = scrapedCompanies.findIndex(c => {
                    const cInfo = c.coinfo || c;
                    return (cInfo.coid || cInfo.ctmId) == coId;
                });
                if (existingIndex !== -1) {
                    scrapedCompanies[existingIndex] = coData;
                } else {
                    scrapedCompanies.push(coData);
                }
                chrome.storage.local.set({ '51job_companies_scraped': scrapedCompanies });

                const companyToSync = {
                    ...coData,
                    platform: '51job',
                    dataSource: '51job_companies_scraped',
                    '平台': '51job',
                    '数据来源': '51job_companies_scraped'
                };
                fetch('http://localhost:3000/api/companies', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify([companyToSync])
                }).catch(() => {});
            }
        }

        if (eventData.type === '51JOB_JOB_CLOSED' && currentWaitingItem && isRunning) {
            if (String(eventData.jobId) !== String(currentWaitingItem.jobId)) return;
            clearTimeout(waitTimer);
            
            console.log(`⚠️ [51job] 职位/公司已暂停招聘，跳过抓取: ${currentWaitingItem.jobId}`);
            notifyPopupStatus(`跳过失效职位...`);
            
            sessionProcessedUrls.add(currentWaitingItem.url);
            scrapedIds.add(currentWaitingItem.jobId);
            
            fetch(`http://localhost:3000/api/jobs/${currentWaitingItem.jobId}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'expired' })
            }).catch(() => {});

            const iframe = getOrCreateIframe();
            iframe.style.display = 'none';

            currentWaitingItem = null;
            setTimeout(scheduleNextJob, 500);
            return;
        }

        if (eventData.type === '51JOB_CAPTCHA_DETECTED' && currentWaitingItem && isRunning) {
            if (String(eventData.jobId) !== String(currentWaitingItem.jobId)) return;
            clearTimeout(waitTimer);
            console.warn(`[风控] 职位 ${currentWaitingItem.jobId} 触发 Access Verification 安全验证`);
            if (currentWaitingItem.element) currentWaitingItem.element.style.boxShadow = '0 0 0 2px #f44336';

            isRunning = false;
            chrome.storage.local.set({ is51jobScraping: false });
            notifyPopupStatus('已因风控要求验证自动停止');
            currentWaitingItem = null;

            if (openMode === 'new_tab') {
                alert(`🚨 抓取已暂停，遇到安全验证（Access Verification）！\n\n请找到刚刚打开的详情页标签页手动完成滑块验证。\n验证通过后返回本页面，重新点击“开始抓取”即可继续。`);
            } else {
                alert(`🚨 抓取已暂停，遇到安全验证（Access Verification）！\n\n请在右下角的【橙色边框小窗】内完成滑块验证。\n验证通过后，重新点击“开始抓取”即可继续。`);
            }
            return;
        }

        if (eventData.type === '51JOB_DETAIL_DATA' && currentWaitingItem && isRunning) {
            if (String(eventData.jobId) !== String(currentWaitingItem.jobId)) return;

            clearTimeout(waitTimer);
            const detailData = eventData.data || {};

            const row = { raw_detail_json: detailData };
            let d = detailData.detailJobInfo || detailData.jobInfo || {};
            row['_detail_address'] = cleanStr(d.companyAddress || d.address || d.workArea);

            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

            const mergedData = { ...currentWaitingItem.baseData, ...row };
            mergedData['更新时间'] = todayStr;
            mergedData['平台'] = '51job';
            mergedData.platform = '51job';

            const existingIndex = scrapedData.findIndex(j => (j.jobId || j['职位ID']) === (mergedData.jobId || mergedData['职位ID']));
            if (existingIndex !== -1) {
                mergedData['创建时间'] = scrapedData[existingIndex]['创建时间'] || todayStr;
                scrapedData[existingIndex] = mergedData;
            } else {
                mergedData['创建时间'] = todayStr;
                scrapedData.push(mergedData);
            }

            sessionProcessedUrls.add(mergedData['url'] || currentWaitingItem.url);
            scrapedIds.add(mergedData.jobId || mergedData['职位ID']);
            saveCache(null, mergedData);

            const displayTitle = mergedData.jobTitle || mergedData.jobName || mergedData['职位名称'] || '未知职位';
            notifyPopupStatus(`成功抓取: ${displayTitle}`);
            console.log(`✅ [51job] 抓取完成: ${displayTitle}`);

            if (currentWaitingItem.element) {
                currentWaitingItem.element.style.boxShadow = '0 0 0 2px #4CAF50';
            }

            // 提取潜在公司信息
            let possibleCompanyData = detailData.companyInfo || detailData.coInfo || detailData.detailCompanyInfo;
            if (possibleCompanyData) {
                const coId = possibleCompanyData.coid || possibleCompanyData.ctmId || possibleCompanyData.companyId;
                if (coId) {
                    const existingIndex = scrapedCompanies.findIndex(c => {
                        const cInfo = c.coinfo || c;
                        return (cInfo.coid || cInfo.ctmId || cInfo.companyId) == coId;
                    });
                    if (existingIndex === -1) {
                        scrapedCompanies.push({ coinfo: possibleCompanyData });
                        chrome.storage.local.set({ '51job_companies_scraped': scrapedCompanies });

                        const companyToSync = {
                            coinfo: possibleCompanyData,
                            platform: '51job',
                            dataSource: '51job_companies_scraped',
                            '平台': '51job',
                            '数据来源': '51job_companies_scraped'
                        };
                        fetch('http://localhost:3000/api/companies', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify([companyToSync])
                        }).catch(() => {});
                    }
                }
            }

            const iframe = getOrCreateIframe();
            iframe.style.display = 'none';

            currentWaitingItem = null;

            const humanDelay = Math.floor(Math.random() * (2200 - 1000 + 1)) + 1000;
            setTimeout(scheduleNextJob, humanDelay);
        }
    }

    window.addEventListener(BRIDGE_EVENT_NAME, (event) => {
        try {
            const data = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
            handleMasterMessagePayload(data);
        } catch (e) {}
    });

    window.addEventListener('message', (event) => {
        if (event.data) handleMasterMessagePayload(event.data);
    });

    function extractListAndContinue() {
        currentList = [];
        let urlMap = {};

        const apiDataAvailable = window.__51JOB_LIST_DATA__ && window.__51JOB_LIST_DATA__.length > 0;

        if (apiDataAvailable) {
            window.__51JOB_LIST_DATA__.forEach(job => {
                if (job.jobId && job.jobUrl) {
                    urlMap[job.jobId] = job.jobUrl;
                }
            });
        }

        const exposureEls = Array.from(document.querySelectorAll('.joblist-item'));
        let skippedBlacklisted = 0;

        if (exposureEls.length > 0) {
            exposureEls.forEach(card => {
                try {
                    const exposureEl = card.querySelector('.sensors_exposure[sensorsdata]');
                    let rawData = {};
                    let jobId = null;

                    if (apiDataAvailable) {
                        const tJobId = exposureEl ? JSON.parse(exposureEl.getAttribute('sensorsdata') || '{}').jobId : null;
                        const matchedJob = window.__51JOB_LIST_DATA__.find(j => j.jobId === tJobId);
                        if (matchedJob) {
                            rawData = matchedJob;
                            jobId = matchedJob.jobId;
                        }
                    }

                    if (!jobId && exposureEl) {
                        const data = JSON.parse(exposureEl.getAttribute('sensorsdata') || '{}');
                        if (data.jobId) {
                            rawData = data;
                            jobId = data.jobId;
                        }
                    }

                    if (jobId) {
                        const url = urlMap[jobId] || rawData.jobUrl || rawData.jobHref || `https://jobs.51job.com/all/${jobId}.html`;
                        rawData['平台'] = '51job';

                        // 黑名单企业前置跳过
                        const compName = rawData.companyName || rawData.coName || '';
                        const fullCompName = rawData.fullCompanyName || '';
                        if (isCompanyBlacklisted(compName) || isCompanyBlacklisted(fullCompName)) {
                            skippedBlacklisted++;
                            sessionProcessedUrls.add(url);
                            scrapedIds.add(String(jobId));
                            console.log(`[51job Scraper] 🚫 跳过黑名单企业职位: 【${fullCompName || compName}】${rawData.jobName || rawData.jobTitle}`);
                            return;
                        }

                        currentList.push({
                            url: url,
                            jobId: jobId,
                            element: card,
                            baseData: rawData
                        });
                    }
                } catch (e) { }
            });
        }

        // 兜底：如果 DOM 找不到卡片，直接从 API 拦截数据中提取
        if (currentList.length === 0 && apiDataAvailable) {
            window.__51JOB_LIST_DATA__.forEach(job => {
                const url = job.jobUrl || job.jobHref || `https://jobs.51job.com/all/${job.jobId}.html`;
                const rawData = { ...job, '平台': '51job' };

                const compName = rawData.companyName || rawData.coName || '';
                const fullCompName = rawData.fullCompanyName || '';
                if (isCompanyBlacklisted(compName) || isCompanyBlacklisted(fullCompName)) {
                    skippedBlacklisted++;
                    sessionProcessedUrls.add(url);
                    scrapedIds.add(String(job.jobId));
                    return;
                }

                currentList.push({
                    url: url,
                    jobId: job.jobId,
                    element: null,
                    baseData: rawData
                });
            });
        }

        if (skippedBlacklisted > 0) {
            console.log(`[51job Scraper] 🛡️ 黑名单前置过滤：共自动跳过 ${skippedBlacklisted} 个黑名单企业职位`);
        }

        // 过滤已经抓取过的
        if (skipScraped) {
            currentList = currentList.filter(item => !sessionProcessedUrls.has(item.url) && !scrapedIds.has(String(item.jobId)));
        } else {
            currentList = currentList.filter(item => !sessionProcessedUrls.has(item.url));
        }

        if (currentList.length === 0) {
            if (isAutoPage) goToNextPage();
            else {
                alert('未找到待抓职位，或当前所有职位已抓取/被黑名单过滤完毕！');
                isRunning = false;
                notifyPopupStatus('完毕');
            }
            return;
        }

        // 🛡️ 零点击极速防风控模式：直接保存列表接口返回的完整数据，不发任何 iframe 请求
        if (isListOnlyMode) {
            notifyPopupStatus(`[零点击模式] 正在快速解析本页 ${currentList.length} 条数据...`);
            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

            currentList.forEach(item => {
                const base = item.baseData || {};
                const row = {
                    ...base,
                    '职位ID': String(item.jobId),
                    '平台': '51job',
                    '数据来源': '51job_scraped_v2',
                    'platform': '51job',
                    'dataSource': '51job_scraped_v2',
                    '职位名称': cleanStr(base.jobName || base.jobTitle),
                    '薪资待遇': cleanStr(base.provideSalaryString || base.jobSalary),
                    '工作地点': cleanStr(base.jobAreaString || base.jobArea),
                    '工作经验': cleanStr(base.workYearString || base.jobYear),
                    '学历要求': cleanStr(base.degreeString || base.jobDegree),
                    '公司名称': cleanStr(base.companyName),
                    '公司全称': cleanStr(base.fullCompanyName || base.companyName),
                    '公司行业': cleanStr(base.companyIndustryType1Str || base.coIndustryText),
                    '公司规模': cleanStr(base.companySizeString),
                    '企业类型': cleanStr(base.companyTypeString),
                    '公司福利': cleanStr(base.jobWelfareCodeDataList ? base.jobWelfareCodeDataList.map(w => w.chineseTitle).join(',') : (base.companyTags ? base.companyTags.join(',') : '')),
                    'HR姓名': cleanStr(base.hrName),
                    'HR职位': cleanStr(base.hrPosition),
                    'HR活跃度': cleanStr(base.hrActive),
                    'HR_ID': cleanStr(base.hrUid),
                    '更新时间': todayStr,
                    '创建时间': todayStr,
                    '抓取时间': new Date().toLocaleString(),
                    '_list_only_mode': true
                };

                const existingIndex = scrapedData.findIndex(j => (j.jobId || j['职位ID']) === String(item.jobId));
                if (existingIndex !== -1) {
                    row['创建时间'] = scrapedData[existingIndex]['创建时间'] || todayStr;
                    scrapedData[existingIndex] = row;
                } else {
                    scrapedData.push(row);
                }

                sessionProcessedUrls.add(item.url);
                scrapedIds.add(String(item.jobId));
                saveCache(null, row);

                if (item.element) {
                    item.element.style.boxShadow = '0 0 0 2px #4CAF50';
                }
            });

            notifyPopupStatus(`本页 ${currentList.length} 条已快速保存！`);
            if (isAutoPage) {
                setTimeout(goToNextPage, getRandomInt(1200, 2000));
            } else {
                alert(`🎉 本页职位已极速保存完毕！共缓存 ${scrapedData.length} 条数据。`);
                isRunning = false;
                notifyPopupStatus('完毕');
            }
            return;
        }

        currentIndex = 0;
        notifyPopupStatus(`提取到 ${currentList.length} 个职位...`);
        processNext();
    }

    function processNext() {
        if (!isRunning) return;

        if (shouldStopAfterCurrent) {
            shouldStopAfterCurrent = false;
            isRunning = false;
            notifyPopupStatus('已暂停');
            if (detailIframe) {
                detailIframe.style.display = 'none';
                detailIframe.src = 'about:blank';
            }
            return;
        }

        if (currentIndex >= currentList.length) {
            if (detailIframe) {
                detailIframe.style.display = 'none';
                detailIframe.src = 'about:blank';
            }
            if (isAutoPage) goToNextPage();
            else { alert('🎉 本页所有职位抓取完毕！'); isRunning = false; notifyPopupStatus('完毕'); }
            return;
        }

        const item = currentList[currentIndex];

        currentList.forEach(i => {
            if (i.element && i !== item) {
                i.element.style.boxShadow = '';
                i.element.style.transform = '';
            }
        });

        if (item.element) {
            item.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            item.element.style.boxShadow = '0 0 20px rgba(255, 71, 87, 0.8)';
            item.element.style.transform = 'scale(1.02)';
            item.element.style.transition = 'all 0.3s ease';
        } else {
            const step = Math.floor((document.documentElement.scrollHeight || document.body.scrollHeight) / currentList.length);
            window.scrollBy({ top: step || 200, behavior: 'smooth' });
        }

        notifyPopupStatus(`抓取第 ${currentIndex + 1}/${currentList.length}`);
        console.log(`[51job] 请求URL: ${item.url}`);

        currentWaitingItem = item;

        // 检查是否是第三方公司外链，如果是，直接跳过详情页抓取，仅保存列表数据
        if (!item.url || !item.url.includes('jobs.51job.com')) {
            console.warn(`[跳过详情] 职位链接指向非标准页面: ${item.url}`);
            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

            const mergedData = { ...item.baseData };
            mergedData['更新时间'] = todayStr;
            mergedData['平台'] = '51job';
            mergedData.platform = '51job';

            const existingIndex = scrapedData.findIndex(j => (j.jobId || j['职位ID']) === (mergedData.jobId || mergedData['职位ID']));
            if (existingIndex !== -1) {
                mergedData['创建时间'] = scrapedData[existingIndex]['创建时间'] || todayStr;
                scrapedData[existingIndex] = mergedData;
            } else {
                mergedData['创建时间'] = todayStr;
                scrapedData.push(mergedData);
            }

            sessionProcessedUrls.add(item.url);
            scrapedIds.add(item.jobId);
            saveCache(null, mergedData);

            if (item.element) {
                item.element.style.boxShadow = '0 0 0 2px #ff9800';
            }

            currentWaitingItem = null;
            setTimeout(scheduleNextJob, 500);
            return;
        }

        if (openMode === 'new_tab') {
            chrome.runtime.sendMessage({ action: '51JOB_OPEN_TAB', url: item.url, closeDelay: getRandomInt(2500, 4200) });
            if (detailIframe) {
                detailIframe.style.display = 'none';
            }
        } else {
            const iframe = getOrCreateIframe();
            iframe.style.display = 'block';
            iframe.src = item.url;
        }

        // 超时保护
        waitTimer = setTimeout(() => {
            if (isRunning && currentWaitingItem === item) {
                console.warn(`[超时] 职位 ${item.jobId} 抓取超时，停止抓取`);
                if (item.element) item.element.style.boxShadow = '0 0 0 2px #f44336';

                isRunning = false;
                chrome.storage.local.set({ is51jobScraping: false });
                notifyPopupStatus('已因超时或验证停止');
                currentWaitingItem = null;

                if (openMode === 'new_tab') {
                    alert(`🚨 抓取已暂停，疑似遇到安全验证！\n\n新标签页加载超时。请找到该详情页标签页手动完成滑块/验证码后，返回本页面重新点击“开始抓取”即可继续。`);
                } else {
                    alert(`🚨 抓取已暂停，疑似遇到安全验证！\n\n请在右下角的【橙色边框小窗】内完成滑块/验证码。完成后重新点击“开始抓取”即可继续。`);
                }
            }
        }, 15000);
    }

    function scheduleNextJob() {
        if (!isRunning) return;
        currentIndex++;
        jobsScrapedSinceRest++;

        if (jobsScrapedSinceRest >= nextRestLimit) {
            const restSec = getRandomInt(18, 30);
            jobsScrapedSinceRest = 0;
            nextRestLimit = getRandomInt(8, 14);
            let c = restSec;
            notifyPopupStatus(`防风控休眠 (${c}s)`);
            const t = setInterval(() => {
                c--;
                if (isRunning) notifyPopupStatus(`防风控休眠 (${c}s)`);
                if (c <= 0 || !isRunning) {
                    clearInterval(t);
                    if (isRunning) setTimeout(processNext, getRandomInt(1000, 2500));
                }
            }, 1000);
        } else {
            const delay = getRandomInt(1800, 3600);
            notifyPopupStatus(`安全休眠 (${(delay / 1000).toFixed(1)}s)`);
            setTimeout(processNext, delay);
        }
    }

    function goToNextPage() {
        const nextBtn = document.querySelector('.btn-next') || document.querySelector('button.btn-next') || document.querySelector('li.btn-next');
        if (nextBtn && !nextBtn.disabled && !nextBtn.classList.contains('disabled')) {
            notifyPopupStatus('自动翻页中...');
            window.__51JOB_LIST_DATA__ = [];

            let timeoutId = null;
            const waitForNewData = new Promise((resolve) => {
                pageChangeResolver = resolve;
                timeoutId = setTimeout(() => {
                    resolve(false);
                }, 4500);
            });

            nextBtn.click();

            waitForNewData.then((hasApi) => {
                if (timeoutId) clearTimeout(timeoutId);
                pageChangeResolver = null;
                if (!isRunning) return;

                const settleDelay = hasApi ? getRandomInt(800, 1500) : getRandomInt(1600, 2600);
                notifyPopupStatus(`新页面就绪，等待 ${(settleDelay / 1000).toFixed(1)}s`);
                setTimeout(() => {
                    if (isRunning) {
                        extractListAndContinue();
                    }
                }, settleDelay);
            });
        } else {
            alert(`🎉 抓取完毕！已到达最后一页，共缓存 ${scrapedData.length} 条数据。`);
            isRunning = false;
            notifyPopupStatus('完毕');
        }
    }

    function startScraping() {
        if (isRunning) return;
        isRunning = true;
        extractListAndContinue();
    }

    // 监听 Popup 指令
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === '51job_start') {
            isAutoPage = request.autoScroll !== false;
            if (request.openMode) {
                openMode = request.openMode;
            }
            if (request.skipScraped !== undefined) {
                skipScraped = request.skipScraped;
            }
            isListOnlyMode = request.listOnly === true;
            sessionProcessedUrls.clear();
            if (!isRunning) {
                loadCache(() => {
                    startScraping();
                });
            }
        } else if (request.action === '51job_stop') {
            if (currentWaitingItem) {
                shouldStopAfterCurrent = true;
                notifyPopupStatus('将在当前职位完成后暂停...');
            } else {
                isRunning = false;
                notifyPopupStatus('已暂停');
                if (detailIframe) {
                    detailIframe.style.display = 'none';
                    detailIframe.src = 'about:blank';
                }
            }
        } else if (request.action === '51job_clear') {
            scrapedData = [];
            scrapedCompanies = [];
            scrapedIds.clear();
            sessionProcessedUrls.clear();
            chrome.storage.local.set({ '51job_companies_scraped': [] });
            saveCache();
        } else if (request.action === '51job_get_status') {
            sendResponse({ isRunning, status: isRunning ? '正在运行...' : '闲置' });
        } else if (request.action === '51JOB_DATA_RETURNED' && request.data) {
            handleMasterMessagePayload(request.data);
        }
    });

    // 探测职位关闭与下线
    if (window.location.href.includes('jobs.51job.com')) {
        setTimeout(() => {
            const bodyText = document.body.innerText || "";
            const isClosed = document.querySelector('.errmsg') ||
                bodyText.includes('职位已停止招聘') ||
                bodyText.includes('职位已关闭') ||
                bodyText.includes('职位已下线') ||
                bodyText.includes('职位已过期') ||
                bodyText.includes('很抱歉，你所访问的页面不存在');

            if (isClosed) {
                const m = location.href.match(/\/(\d+)\.html/);
                const jobId = m ? m[1] : null;
                if (jobId) {
                    fetch(`http://localhost:3000/api/jobs/${jobId}/status`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: 'expired' })
                    }).catch(() => {});
                }
            }
        }, 2000);
    }

})();
