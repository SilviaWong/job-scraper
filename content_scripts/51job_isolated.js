(function () {
    'use strict';

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

    // [Worker 模式已废弃]：现在详情页数据由内嵌 iframe 获取，
    // 因此这里不再需要注入任何独立运行并自动关闭的后台脚本逻辑。
    // 如果页面处于详情页（jobs.51job.com），不执行任何干预。


    // ==========================================
    // 列表页 (Master) 逻辑
    // ==========================================
    const isMaster = window.self === window.top && window.location.href.includes('we.51job.com');
    // 精确判定：职位详情页 URL 必须是 jobs.51job.com，且必须以纯数字ID.html结尾（如 /shanghai-mhq/76704463.html）
    // 排除公司主页（如 /all/coAWRUN146BT4CYAdmUTE.html）
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

        // 轮询检查页面是否有“暂停招聘”或“安全验证”
        let checkCount = 0;
        const checkTimer = setInterval(() => {
            checkCount++;
            const bodyText = document.body.innerText || "";
            if (bodyText.includes("很抱歉，您选择的公司目前已经暂停招聘") || bodyText.includes("很抱歉，您选择的职位目前已经暂停招聘")) {
                clearInterval(checkTimer);
                const match = window.location.href.match(/\/(\d+)\.html/);
                const jobId = match ? match[1] : null;
                console.log(`[51job Detail] 检测到职位/公司已暂停招聘: ${jobId}`);
                
                chrome.runtime.sendMessage({ 
                    action: '51JOB_DATA_EXTRACTED', 
                    data: { type: '51JOB_JOB_CLOSED', jobId: jobId } 
                }).catch(() => {});

                if (window.location.href.includes('auto_close=1')) {
                    setTimeout(() => {
                        try { chrome.runtime.sendMessage({ action: '51JOB_CLOSE_TAB', isMaster: false }); } catch(e){}
                        try { window.close(); } catch(e){}
                    }, 1000);
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

        // 主动向拦截器请求已缓存的 API 数据
        window.postMessage({ type: '51JOB_REQUEST_API_CACHE' }, '*');

        // 监听拦截器发送的数据
        window.addEventListener('message', (event) => {
            if (!event.data) return;
            if (event.data.type === '51JOB_DETAIL_DATA') {
                interceptedDetailData = event.data.data;
                // 如果是列表页自动化触发的后台标签页，转发给 master
                chrome.runtime.sendMessage({ action: '51JOB_DATA_EXTRACTED', data: event.data }).catch(() => {});
                
                if (event.data.error === "BLOCKED_BY_CAPTCHA") {
                    console.log("⚠️ [51job Detail] 遇到验证码或安全拦截，保留当前页面以便手动验证。");
                    return;
                }

                // 尝试执行独立保存（仅自动化后台标签页或iframe中静默，前台用户主动打开时正常弹窗提示）
                const isAutoTab = window.location.href.includes('auto_close=1') || (window.self !== window.top);
                scrapeSinglePage(isAutoTab);

                if (window.location.href.includes('auto_close=1')) {
                    console.log(`[51job Detail] 后台标签页已提取数据，5秒后自动关闭...`);
                    setTimeout(() => {
                        try { chrome.runtime.sendMessage({ action: '51JOB_CLOSE_TAB', isMaster: false }); } catch (e) {}
                        try { window.close(); } catch (e) {}
                    }, 5000);
                }
            } else if (event.data.type === '51JOB_COMPANY_DATA') {
                interceptedCompanyData = event.data.data;
                chrome.runtime.sendMessage({ action: '51JOB_DATA_EXTRACTED', data: event.data }).catch(() => {});
                // 公司信息到达后，若已抓取过则更新公司库
                if (hasScrapedThisPage) {
                    const isAutoTab = window.location.href.includes('auto_close=1') || (window.self !== window.top);
                    scrapeSinglePage(isAutoTab);
                }
            } else if (event.data.type === '51JOB_API_CACHE_RETURNED') {
                if (event.data.detailData) interceptedDetailData = event.data.detailData;
                else if (event.data.data && event.data.data.detailJobInfo) interceptedDetailData = event.data.data;
                if (event.data.companyData) interceptedCompanyData = event.data.companyData;
            }
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

                // 保存到 51job_single_details 影子库
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
                    let newlyAddedComp = null;

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
                            newlyAddedComp = compData;
                        }
                    }

                    // 暂时不保存到扩展程序本地缓存中
                    // chrome.storage.local.set({
                    //     '51job_single_details': list,
                    //     '51job_companies_scraped': compList
                    // }, () => {
                    //     console.log(`[51job Detail] 职位详情已保存到 51job_single_details: ${row['职位名称']} (${jobId})`);
                    // });

                    const wasAlreadyScraped = hasScrapedThisPage;
                    hasScrapedThisPage = true;
                    if (!isSilent && !wasAlreadyScraped) {
                        showToast('✅ 51job职位详情已自动抓取，关键数据已同步至主库！');
                    } else if (isSilent === false && wasAlreadyScraped) {
                        showToast('✅ 51job职位详情已重新抓取，关键数据已同步至主库！');
                    }
                    console.log(`[51job Detail] 职位详情已成功抓取: ${row['职位名称']} (${jobId})`);

                    // 尝试推送职位详情到本地服务器（同时挂载独立的纯净企业卡片数据 companyCard，供服务端写入 Company.rawData3）
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
                window.postMessage({ type: '51JOB_REQUEST_API_CACHE' }, '*');
                setTimeout(() => {
                    scrapeSinglePage(window.location.href.includes('auto_close=1'));
                }, 300);
            }
        }, 2000);

        return; // 详情页执行专属单页逻辑，不执行后面的列表主控逻辑
    }

    if (!isMaster) return;
    let isRunning = false;
    let shouldStopAfterCurrent = false;
    let isAutoPage = true;
    let openMode = 'iframe';
    let skipScraped = true;
    let currentList = [];
    let currentIndex = 0;
    let scrapedData = [];
    let scrapedCompanies = [];
    let scrapedIds = new Set();
    let sessionProcessedUrls = new Set();
    let currentWaitingItem = null;
    let waitTimer = null;
    let jobsScrapedSinceRest = 0;
    let nextRestLimit = getRandomInt(8, 12);

    function getRandomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

    function loadCache(callback) {
        chrome.storage.local.get(['51job_scraped_v2', '51job_companies_scraped'], (res) => {
            scrapedData = Array.isArray(res['51job_scraped_v2']) ? res['51job_scraped_v2'] : [];
            scrapedCompanies = Array.isArray(res['51job_companies_scraped']) ? res['51job_companies_scraped'] : [];
            scrapedIds = new Set(scrapedData.map(d => String(d.jobId || d['职位ID'] || '')).filter(Boolean));
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

            // https://job-dashboard-bgr.pages.dev (已注释)
            // fetch('https://job-dashboard-bgr.pages.dev/api/jobs', {
            //     method: 'POST',
            //     headers: { 'Content-Type': 'application/json' },
            //     body: JSON.stringify([newRow])
            // }).catch(err => {
            //     // 如果本地服务器未开启，这里会忽略错误，不影响原有逻辑
            //     console.log('[51job Scraper] Remote server sync failed (expected if not running):', err);
            // });
        }
    }

    function notifyPopupStatus(statusText) {
        chrome.runtime.sendMessage({ action: '51job_update_status', isRunning, status: statusText });
    }

    function notifyPopupCount() {
        chrome.runtime.sendMessage({ action: '51job_update_count', count: scrapedData.length });
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
            detailIframe.style.border = '3px solid #ff9800'; // 醒目的橙色边框
            detailIframe.style.borderRadius = '8px';
            detailIframe.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
            detailIframe.style.background = '#fff';
            detailIframe.style.display = 'none';
            document.body.appendChild(detailIframe);
        }
        return detailIframe;
    }

    // 接收 iframe 中拦截器传回的数据
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === '51JOB_COMPANY_DATA' && event.data.data) {
            console.log("🌟 [51job Isolated] 收到公司数据消息:", event.data);
            const coData = event.data.data;
            let coId = event.data.coId;
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
                chrome.storage.local.set({ '51job_companies_scraped': scrapedCompanies }, () => {
                    console.log("🌟 [51job Isolated] 公司数据已保存至 Storage，当前总数:", scrapedCompanies.length);
                });

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
                }).catch(err => {
                    console.log('[51job Scraper] Local server sync failed:', err);
                });

                // https://job-dashboard-bgr.pages.dev (已注释)
                // fetch('https://job-dashboard-bgr.pages.dev/api/companies', {
                //     method: 'POST',
                //     headers: { 'Content-Type': 'application/json' },
                //     body: JSON.stringify([companyToSync])
                // }).catch(err => {
                //     console.log('[51job Scraper] Local server sync failed:', err);
                // });

            } else {
                console.warn("⚠️ [51job Isolated] 收到公司数据但未能提取出 coId，无法保存:", coData);
            }
        }

        if (event.data && event.data.type === '51JOB_JOB_CLOSED' && currentWaitingItem && isRunning) {
            // 确保是当前正在等待的职位
            if (String(event.data.jobId) !== String(currentWaitingItem.jobId)) return;

            clearTimeout(waitTimer);
            
            console.log(`⚠️ [51job] 职位/公司已暂停招聘，跳过抓取: ${currentWaitingItem.jobId}`);
            notifyPopupStatus(`跳过失效职位...`);
            
            // 记录到已处理缓存，避免重复点击
            sessionProcessedUrls.add(currentWaitingItem.url);
            scrapedIds.add(currentWaitingItem.jobId);
            
            // 可以通过 API 更新状态为 expired
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

        if (event.data && event.data.type === '51JOB_CAPTCHA_DETECTED' && currentWaitingItem && isRunning) {
            // 确保是当前正在等待的职位
            if (String(event.data.jobId) !== String(currentWaitingItem.jobId)) return;

            clearTimeout(waitTimer);
            console.warn(`[风控] 职位 ${currentWaitingItem.jobId} 触发 Access Verification 安全验证`);
            if (currentWaitingItem.element) currentWaitingItem.element.style.boxShadow = '0 0 0 2px #f44336';

            isRunning = false;
            chrome.storage.local.set({ is51jobScraping: false });
            notifyPopupStatus('已因风控要求验证自动停止');
            currentWaitingItem = null;

            if (openMode === 'new_tab') {
                alert(`🚨 抓取已暂停，遇到安全验证（Access Verification）！\n\n请找到刚刚弹出的详情页标签页，手动完成滑块验证。\n验证通过后返回本页面，重新点击“开始抓取”即可继续。`);
            } else {
                alert(`🚨 抓取已暂停，遇到安全验证（Access Verification）！\n\n请在右下角的【橙色边框小窗】内完成滑块验证。\n验证通过后，重新点击“开始抓取”即可继续。`);
            }
            return;
        }

        if (event.data && event.data.type === '51JOB_DETAIL_DATA' && currentWaitingItem && isRunning) {
            // 确保是当前正在等待的职位
            if (String(event.data.jobId) !== String(currentWaitingItem.jobId)) return;

            clearTimeout(waitTimer);
            const detailData = event.data.data || {};

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

            // 尝试从详情接口中直接提取公司信息（如果 51job 没有单独发 company-info 请求的话）
            let possibleCompanyData = null;
            if (detailData.companyInfo) possibleCompanyData = detailData.companyInfo;
            else if (detailData.coInfo) possibleCompanyData = detailData.coInfo;
            else if (detailData.detailCompanyInfo) possibleCompanyData = detailData.detailCompanyInfo;

            if (possibleCompanyData) {
                console.log("🌟 [51job Isolated] 尝试从 Detail API 提取公司数据:", possibleCompanyData);
                const coId = possibleCompanyData.coid || possibleCompanyData.ctmId || possibleCompanyData.companyId;
                if (coId) {
                    const existingIndex = scrapedCompanies.findIndex(c => {
                        const cInfo = c.coinfo || c;
                        return (cInfo.coid || cInfo.ctmId || cInfo.companyId) == coId;
                    });
                    if (existingIndex !== -1) {
                        // 如果已经存在专门拦截到的公司数据，则不使用详情页的简略数据覆盖
                        console.log("🌟 [51job Isolated] 公司数据已存在，跳过兜底覆盖");
                    } else {
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
                        }).catch(err => {
                            console.log('[51job Scraper] Local server sync failed:', err);
                        });

                        // https://job-dashboard-bgr.pages.dev (已注释)
                        // fetch('https://job-dashboard-bgr.pages.dev/api/companies', {
                        //     method: 'POST',
                        //     headers: { 'Content-Type': 'application/json' },
                        //     body: JSON.stringify([companyToSync])
                        // }).catch(err => {
                        //     console.log('[51job Scraper] Remote server sync failed (expected if not running):', err);
                        // });
                    }
                }
            }

            // 不再立刻清理 iframe，因为详情页可能还在同时请求 company-info API。
            // 立即清理会导致 company-info 的 fetch 被 abort，从而丢失公司数据。
            const iframe = getOrCreateIframe();
            iframe.style.display = 'none';
            // iframe.src = 'about:blank'; // 移除此行

            currentWaitingItem = null;

            // 随机延迟防风控
            const humanDelay = Math.floor(Math.random() * (2500 - 1000 + 1)) + 1000;
            setTimeout(scheduleNextJob, humanDelay);
        }
    });

    function extractListAndContinue() {
        currentList = [];
        let urlMap = {};

        // 构建真实 URL 映射表（从拦截器拿到的 search-pc API 数据）
        // 并且如果存在拦截到的全量 JSON，我们将其作为最权威的 raw data 来源
        const apiDataAvailable = window.__51JOB_LIST_DATA__ && window.__51JOB_LIST_DATA__.length > 0;

        if (apiDataAvailable) {
            window.__51JOB_LIST_DATA__.forEach(job => {
                if (job.jobId && job.jobUrl) {
                    urlMap[job.jobId] = job.jobUrl;
                }
            });
        }

        // 首选：通过 DOM 上的卡片查找
        const exposureEls = Array.from(document.querySelectorAll('.joblist-item'));

        if (exposureEls.length > 0) {
            exposureEls.forEach(card => {
                try {
                    const exposureEl = card.querySelector('.sensors_exposure[sensorsdata]');
                    let rawData = {};
                    let jobId = null;

                    if (apiDataAvailable) {
                        // 尝试在 api 数据中找到对应的 job
                        const tJobId = exposureEl ? JSON.parse(exposureEl.getAttribute('sensorsdata') || '{}').jobId : null;
                        const matchedJob = window.__51JOB_LIST_DATA__.find(j => j.jobId === tJobId);
                        if (matchedJob) {
                            rawData = matchedJob;
                            jobId = matchedJob.jobId;
                        }
                    }

                    // 兜底：如果 API 里找不到，用 sensorsdata 凑合
                    if (!jobId && exposureEl) {
                        const data = JSON.parse(exposureEl.getAttribute('sensorsdata') || '{}');
                        if (data.jobId) {
                            rawData = data; // 虽不完整，但聊胜于无
                            jobId = data.jobId;
                        }
                    }

                    if (jobId) {
                        const url = urlMap[jobId] || rawData.jobUrl || rawData.jobHref || `https://jobs.51job.com/all/${jobId}.html`;
                        rawData['平台'] = '51job';

                        currentList.push({
                            url: url,
                            jobId: jobId,
                            element: card,
                            baseData: rawData // 核心改变：保存完整的原生态 JSON
                        });
                    }
                } catch (e) { }
            });
        }

        // 兜底：如果 DOM 完全拿不到数据，则直接使用 API 拦截的数据
        if (currentList.length === 0 && apiDataAvailable) {
            currentList = window.__51JOB_LIST_DATA__.map(job => {
                const url = job.jobUrl || job.jobHref || `https://jobs.51job.com/all/${job.jobId}.html`;
                const rawData = { ...job, '平台': '51job' };

                return {
                    url: url,
                    jobId: job.jobId,
                    element: null,
                    baseData: rawData
                };
            });
        }

        // 过滤已经抓取过的
        if (skipScraped) {
            currentList = currentList.filter(item => !sessionProcessedUrls.has(item.url) && !scrapedIds.has(String(item.jobId)));
        } else {
            // 不跳过历史抓取，但仍要避免本次循环重复抓取
            currentList = currentList.filter(item => !sessionProcessedUrls.has(item.url));
        }

        if (currentList.length === 0) {
            if (isAutoPage) goToNextPage();
            else {
                alert('未找到职位列表，或当前可见职位已抓取完毕！');
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

        // 样式重置
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
        // 标准职位详情必定包含 jobs.51job.com，类似 companyname.51job.com 的也是特殊页面，需跳过
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
                item.element.style.boxShadow = '0 0 0 2px #ff9800'; // 橙色边框表示仅保存了列表数据
            }

            currentWaitingItem = null;
            setTimeout(scheduleNextJob, 500); // 直接抓取下一个
            return;
        }

        if (openMode === 'new_tab') {
            const separator = item.url.includes('?') ? '&' : '?';
            const autoCloseUrl = item.url + separator + 'auto_close=1';
            chrome.runtime.sendMessage({ action: '51JOB_OPEN_TAB', url: autoCloseUrl });
            if (detailIframe) {
                detailIframe.style.display = 'none';
            }
        } else {
            // 通过可见的 iframe 加载详情页，方便用户处理验证码
            const iframe = getOrCreateIframe();
            iframe.style.display = 'block';
            iframe.src = item.url;
        }

        // 超时保护
        waitTimer = setTimeout(() => {
            if (isRunning && currentWaitingItem === item) {
                console.warn(`[超时] 职位 ${item.jobId} 抓取超时，停止抓取`);
                if (item.element) item.element.style.boxShadow = '0 0 0 2px #f44336';

                // 超时或报错直接停止抓取并弹窗提示
                isRunning = false;
                chrome.storage.local.set({ is51jobScraping: false });
                notifyPopupStatus('已因风控要求验证自动停止');
                currentWaitingItem = null;

                if (openMode === 'new_tab') {
                    alert(`🚨 抓取已暂停，疑似遇到安全验证！\n\n新标签页（可能在后台）加载超时。请找到该详情页标签页手动完成滑块/验证码。验证通过后，该页面会正常显示。此时返回本页面重新点击“开始抓取”即可继续。`);
                } else {
                    alert(`🚨 抓取已暂停，疑似遇到安全验证！\n\n请在页面右下角的【橙色边框小窗】内完成滑块/验证码。验证通过后，该小窗会显示正常的职位页面。此时重新点击插件面板的“开始抓取”即可继续。`);
                }
            }
        }, 15000);
    }

    function scheduleNextJob() {
        if (!isRunning) return;
        currentIndex++;
        jobsScrapedSinceRest++;

        if (jobsScrapedSinceRest >= nextRestLimit) {
            const restSec = getRandomInt(20, 35);
            jobsScrapedSinceRest = 0;
            nextRestLimit = getRandomInt(8, 12);
            let c = restSec;
            notifyPopupStatus(`防风控休眠 (${c}s)`);
            const t = setInterval(() => {
                c--;
                if (isRunning) notifyPopupStatus(`防风控休眠 (${c}s)`);
                if (c <= 0 || !isRunning) {
                    clearInterval(t);
                    if (isRunning) setTimeout(processNext, getRandomInt(1000, 3000));
                }
            }, 1000);
        } else {
            const delay = getRandomInt(2000, 4000);
            notifyPopupStatus(`人类模拟 (${(delay / 1000).toFixed(1)}s)`);
            setTimeout(processNext, delay);
        }
    }

    function goToNextPage() {
        const nextBtn = document.querySelector('.btn-next') || document.querySelector('button.btn-next') || document.querySelector('li.btn-next');
        if (nextBtn && !nextBtn.disabled && !nextBtn.classList.contains('disabled')) {
            notifyPopupStatus('自动翻页中...');
            window.__51JOB_LIST_DATA__ = []; // 翻页前清空
            nextBtn.click();

            setTimeout(() => {
                if (isRunning) {
                    notifyPopupStatus('提取新页面列表...');
                    extractListAndContinue();
                }
            }, 4000);
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
            isAutoPage = request.autoScroll;
            if (request.openMode) {
                openMode = request.openMode;
            }
            if (request.skipScraped !== undefined) {
                skipScraped = request.skipScraped;
            }
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
            // 接收新标签页传回的数据，并通过 postMessage 转发给原有的处理逻辑
            window.postMessage(request.data, '*');
        }
    });

    // 监听 MAIN World 拦截到的 API 数据（用于兜底）
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === '51JOB_LIST_DATA') {
            window.__51JOB_LIST_DATA__ = event.data.data;
        }
    });

    // === 详情页自动探测职位关闭 ===
    if (window.location.href.includes('jobs.51job.com')) {
        setTimeout(() => {
            const bodyText = document.body.innerText || "";
            const isClosed = document.querySelector('.errmsg') ||
                bodyText.includes('职位已停止招聘') ||
                bodyText.includes('职位已关闭') ||
                bodyText.includes('职位已下线') ||
                bodyText.includes('职位已过期') ||
                bodyText.includes('很抱歉，你所访问的页面不存在');

            // if (isClosed) {
            //     const m = location.href.match(/\/(\d+)\.html/);
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
