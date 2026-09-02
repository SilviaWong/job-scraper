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

    function cleanMultiLineStr(str) {
        if (str == null) return '';
        if (Array.isArray(str)) str = str.join('\n');
        return String(str).replace(/"/g, '""').trim();
    }

    function formatActiveTime(desc) {
        let activeTime = cleanStr(desc);
        if (activeTime === '刚刚活跃' || activeTime === '今日活跃' || activeTime === '在线' || activeTime === '刚刚在线') {
            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        }
        return activeTime;
    }

    // 强健解析 script 标签中的 __INITIAL_STATE__
    function extractInitialStateObject() {
        try {
            const scripts = document.querySelectorAll('script');
            for (let s of scripts) {
                const text = s.innerHTML || s.textContent || '';
                if (text.includes('__INITIAL_STATE__')) {
                    // 正则提取
                    const match = text.match(/__INITIAL_STATE__\s*=\s*(\{.*?\});?/s);
                    if (match) {
                        try { return JSON.parse(match[1]); } catch (e) {}
                    }
                    // 子字符串截取提取兜底
                    const startIdx = text.indexOf('__INITIAL_STATE__');
                    if (startIdx !== -1) {
                        const objStart = text.indexOf('{', startIdx);
                        if (objStart !== -1) {
                            let jsonStr = text.substring(objStart).trim();
                            const lastClose = jsonStr.lastIndexOf('}');
                            if (lastClose !== -1) {
                                jsonStr = jsonStr.substring(0, lastClose + 1);
                                try { return JSON.parse(jsonStr); } catch (e) {}
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[Zhilian Scraper] extractInitialStateObject error:', e);
        }
        return null;
    }

    function extractInitialState() {
        try {
            const state = extractInitialStateObject();
            if (state) {
                const jobs = state.positionList ||
                    (state.searchResult && state.searchResult.positionList) ||
                    (state.jobList && state.jobList.list) ||
                    (state.data && state.data.list) || [];

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
        const jobDetailData = data.jobDetail || data;
        const pos = jobDetailData.detailedPosition || jobDetailData.position || data.position || {};
        const base = pos.base || {};
        const desc = pos.desc || {};
        const workLocation = pos.workLocation || {};
        const comp = jobDetailData.detailedCompany || jobDetailData.company || data.company || {};
        const staff = pos.staff || jobDetailData.staff || data.staff || {};

        const jobId = cleanStr(
            pos.number ||
            pos.positionNumber ||
            base.positionNumber ||
            (data.data && data.data.number) ||
            (data.detailedPosition && data.detailedPosition.positionNumber) ||
            data.number
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

        // 全面映射结构化中文标准字段
        row['职位名称'] = cleanStr(
            pos.positionName || pos.name || base.positionName || base.name ||
            row.name || row.jobName || (row.position && row.position.base && row.position.base.positionName)
        );

        row['薪资待遇'] = cleanStr(
            pos.salary || base.salary || base.salary60 || row.salary60 || row.salary
        );

        row['工作经验'] = cleanStr(
            pos.positionWorkingExp || pos.workingExp || base.positionWorkingExp || base.workingExp || row.workingExp
        );

        row['学历要求'] = cleanStr(
            pos.education || base.education || row.education
        );

        const cityStr = [
            pos.positionWorkCity || pos.workCity || workLocation.cityName || row.workCity,
            pos.positionCityDistrict || pos.cityDistrict || workLocation.cityDistrict || row.cityDistrict
        ].filter(Boolean).join('·');
        row['工作城市'] = cityStr;
        row['工作地点'] = cityStr || cleanStr(pos.workCity || row.workCity);

        row['详细完整地址'] = cleanStr(
            pos.workAddress || workLocation.workAddress || row.workAddress
        );
        row['经度'] = pos.longitude || workLocation.longitude || '';
        row['纬度'] = pos.latitude || workLocation.latitude || '';

        row['职位描述'] = cleanMultiLineStr(
            pos.description || pos.jobDesc || desc.description || row.jobDesc
        );

        const skillsArr = (pos.skillLabel || []).map(s => s?.value || s?.name || s).filter(Boolean).concat(
            (desc.labels || []).map(s => s?.typeName || s?.name || s).filter(Boolean)
        );
        row['技能标签'] = skillsArr.length > 0 ? skillsArr.join(',') : cleanStr(row.jobSkillTags ? row.jobSkillTags.map(s => s.name || s.value).join(',') : '');

        row['公司名称'] = cleanStr(
            comp.companyShotName || comp.kgDisplayShortName || comp.companyName || comp.name || row.companyName
        );

        row['公司全称'] = cleanStr(
            comp.companyName || comp.name || row.companyName || row['公司名称']
        );

        row['公司ID'] = cleanStr(
            comp.companyNumber || pos.companyNumber || row.companyNumber
        );

        row['公司行业'] = cleanStr(
            comp.industryNameLevel || comp.industryLevel || comp.industryName || row.industryName
        );

        row['公司规模'] = cleanStr(
            comp.companySize || comp.size || row.companySize
        );

        row['融资阶段'] = cleanStr(
            comp.financingStageName || row.financingStage?.name
        );

        row['HR姓名'] = cleanStr(
            staff.staffName || row.staff?.staffName
        );

        row['HR职位'] = cleanStr(
            staff.hrJob || row.staff?.hrJob
        );

        row['HR活跃度'] = cleanStr(
            staff.hrOnlineState || staff.lastOnlineTimeText || row.staff?.hrOnlineState
        );

        row['职位链接'] = row.positionURL || `https://www.zhaopin.com/jobdetail/${finalJobId}.htm`;
        row['干净链接'] = row['职位链接'];

        row['页面更新时间'] = cleanStr(
            pos.positionPublishTime || pos.publishTime || row.publishTime
        );

        upsertData(finalJobId, row, () => {
            console.log(`✅ [已更新 ${scrapedData.length}] ${finalJobId} | ${row['职位名称']} | ${row['公司全称']} | ${row['薪资待遇']}`);
            scheduleNextJob();
        });
    }

    // 从页面 DOM 元素中提取详情数据（用于兜底或无 __INITIAL_STATE__ 的页面）
    function extractDetailFromDOM() {
        const dom = {};
        try {
            // 1. 职位标题
            const titleEl = document.querySelector('.summary-planes__title span, .summary-planes__title, h1.summary-planes__title, .job-summary h1');
            if (titleEl) dom['职位名称'] = cleanStr(titleEl.textContent);

            // 2. 薪资
            const salaryEl = document.querySelector('.summary-planes__salary, .job-summary .salary');
            if (salaryEl) dom['薪资待遇'] = cleanStr(salaryEl.textContent);

            // 3. 基础信息列表 (城市/经验/学历/性质/人数)
            const infoLis = document.querySelectorAll('.summary-planes__info li, .job-summary__info li');
            infoLis.forEach((li, index) => {
                const text = cleanStr(li.textContent);
                if (!text) return;
                if (li.querySelector('.workCity-link') || (index === 0 && !text.includes('年') && !text.includes('本') && !text.includes('专'))) {
                    dom['工作地点'] = text;
                    const cityLink = li.querySelector('.workCity-link');
                    if (cityLink) {
                        const cityName = cleanStr(cityLink.textContent);
                        const distSpan = li.querySelector('span');
                        const distName = distSpan ? cleanStr(distSpan.textContent) : '';
                        dom['工作城市'] = [cityName, distName].filter(Boolean).join('·');
                    }
                } else if (text.includes('年') || text.includes('经验') || text.includes('应届') || text.includes('不限')) {
                    dom['工作经验'] = text;
                } else if (/本科|大专|硕士|博士|中专|高中|初中|学历/.test(text)) {
                    dom['学历要求'] = text;
                } else if (/全职|兼职|实习|校招/.test(text)) {
                    dom['工作类型'] = text;
                } else if (/招\d+人|若干/.test(text)) {
                    dom['招聘人数'] = text;
                }
            });

            // 4. 更新时间
            const timeEl = document.querySelector('.summary-planes__time, .summary-planes__other span');
            if (timeEl) dom['页面更新时间'] = cleanStr(timeEl.textContent).replace(/更新时间\s*/, '');

            // 5. 技能标签
            const skillEls = document.querySelectorAll('.describtion-card__skills-item, .skills-item, .job-summary__tags span');
            if (skillEls.length > 0) {
                dom['技能标签'] = Array.from(skillEls).map(el => cleanStr(el.textContent)).filter(Boolean).join(',');
            }

            // 6. 职位描述
            const descEl = document.querySelector('.describtion-card__detail-content, .job-detail-content, .describtion-card');
            if (descEl) dom['职位描述'] = cleanMultiLineStr(descEl.innerText);

            // 7. 详细地址
            const addrEl = document.querySelector('.address-info__bubble, .job-address, .address-info__content');
            if (addrEl) dom['详细完整地址'] = cleanStr(addrEl.textContent);

            // 8. 公司信息卡片
            const compNameEl = document.querySelector('.company-info__name, .company-name');
            if (compNameEl) {
                dom['公司名称'] = cleanStr(compNameEl.textContent);
                dom['公司全称'] = cleanStr(compNameEl.textContent);
                const href = compNameEl.getAttribute('href') || '';
                const m = href.match(/companydetail\/([A-Za-z0-9]+)/);
                if (m) dom['公司ID'] = m[1];
            }

            // 9. 公司规模/行业/融资
            const compDescEl = document.querySelector('.company-info__desc');
            if (compDescEl) {
                const descText = cleanStr(compDescEl.textContent);
                const parts = descText.split(/[\s·]+/).filter(Boolean);
                parts.forEach(part => {
                    if (/人$/.test(part) || /人以上$/.test(part) || /少于\d+人/.test(part)) {
                        dom['公司规模'] = part;
                    } else if (/融资|未融资|上市|不需要融资|天使轮|A轮|B轮|C轮|D轮/.test(part)) {
                        dom['融资阶段'] = part;
                    } else if (!dom['公司行业'] && part !== '已审核' && part !== '未审核') {
                        dom['公司行业'] = part;
                    }
                });
            }

            // 10. 工商信息
            const bizItems = document.querySelectorAll('.company-info__business-item');
            bizItems.forEach(item => {
                const label = cleanStr(item.querySelector('.company-info__business-label')?.textContent);
                const value = cleanStr(item.querySelector('.company-info__business-value')?.textContent);
                if (!label || !value) return;
                if (label.includes('企业名称')) dom['公司全称'] = value;
                else if (label.includes('法人代表') || label.includes('法定代表人')) dom['法定代表人'] = value;
                else if (label.includes('企业类型')) dom['企业类型'] = value;
                else if (label.includes('经营状态')) dom['经营状态'] = value;
                else if (label.includes('成立时间') || label.includes('成立日期')) dom['成立日期'] = value;
                else if (label.includes('注册资本') || label.includes('注册资金')) dom['注册资金'] = value;
            });

        } catch (e) {
            console.error('[Zhilian Scraper] extractDetailFromDOM error:', e);
        }
        return dom;
    }

    function scrapeSinglePage() {
        try {
            const m = location.href.match(/\/jobdetail\/([^.?#]+)\.htm/) || location.href.match(/(CC[0-9A-Za-z]+)\.htm/);
            const jobId = m ? (m[1] || m[0].replace('.htm', '')) : `ID_${Date.now()}`;

            const initialState = extractInitialStateObject();
            const domData = extractDetailFromDOM();

            const row = {
                '职位ID': jobId,
                '平台': 'zhilian',
                '数据来源': 'zhilian_scraped_v2', // 统一使用新版处理逻辑
                'platform': 'zhilian',
                'dataSource': 'zhilian_scraped_v2',
                '抓取时间': new Date().toLocaleString(),
                '职位链接': location.href.split('?')[0],
                '干净链接': location.href.split('?')[0]
            };

            // 1. 如果有 initialState，优先提取结构化 JSON 数据
            if (initialState) {
                if (initialState.jobDetail) {
                    row.jobDetail = initialState.jobDetail;
                } else {
                    row.jobDetail = initialState;
                }

                const jobDetail = initialState.jobDetail || initialState;
                const pos = jobDetail.detailedPosition || jobDetail.position || {};
                const base = pos.base || {};
                const desc = pos.desc || {};
                const comp = jobDetail.detailedCompany || jobDetail.company || {};
                const staff = pos.staff || jobDetail.staff || {};
                const biz = initialState.companyExtDetail?.businessInformation?.businessInformationData || {};

                row['职位名称'] = cleanStr(pos.positionName || pos.name || base.positionName || base.name);
                row['薪资待遇'] = cleanStr(pos.salary || base.salary || base.salary60);
                row['工作经验'] = cleanStr(pos.positionWorkingExp || pos.workingExp || base.positionWorkingExp || base.workingExp);
                row['学历要求'] = cleanStr(pos.education || base.education);
                row['工作城市'] = [pos.positionWorkCity || pos.workCity || pos.workLocation?.cityName, pos.positionCityDistrict || pos.cityDistrict || pos.workLocation?.cityDistrict].filter(Boolean).join('·');
                row['工作地点'] = row['工作城市'] || cleanStr(pos.workCity);
                row['详细完整地址'] = cleanStr(pos.workAddress || pos.workLocation?.workAddress);
                row['经度'] = pos.longitude || pos.workLocation?.longitude || '';
                row['纬度'] = pos.latitude || pos.workLocation?.latitude || '';
                row['职位描述'] = cleanMultiLineStr(pos.description || pos.jobDesc || desc.description);
                row['技能标签'] = (pos.skillLabel || []).map(s => s?.value || s?.name || s).filter(Boolean).join(',') ||
                                  (desc.labels || []).map(s => s?.typeName || s?.name || s).filter(Boolean).join(',');
                row['公司名称'] = cleanStr(comp.companyShotName || comp.kgDisplayShortName || comp.companyName || comp.name || pos.companyName);
                row['公司全称'] = cleanStr(comp.companyName || comp.name || biz.registeredName || pos.companyName);
                row['公司ID'] = cleanStr(comp.companyNumber || pos.companyNumber);
                row['公司行业'] = cleanStr(comp.industryNameLevel || comp.industryLevel || comp.industryName);
                row['公司规模'] = cleanStr(comp.companySize || comp.size);
                row['融资阶段'] = cleanStr(comp.financingStageName);
                row['公司福利'] = (pos.welfareTags || []).filter(Boolean).join(',');
                row['HR姓名'] = cleanStr(staff.staffName);
                row['HR职位'] = cleanStr(staff.hrJob);
                row['HR活跃度'] = cleanStr(staff.hrOnlineState || staff.lastOnlineTimeText);
                row['法定代表人'] = cleanStr(biz.legalPerson);
                row['企业类型'] = cleanStr(biz.epType);
                row['成立日期'] = cleanStr(biz.createDate);
                row['经营状态'] = cleanStr(biz.epStatus);
                row['注册资金'] = cleanStr(biz.registeredCapital);
                row['统一社会信用代码'] = cleanStr(biz.epCertNo);
                row['页面更新时间'] = cleanStr(pos.positionPublishTime || pos.publishTime);
                row['发布时间'] = cleanStr(pos.positionPublishTime || pos.publishTime);
            }

            // 2. 用 DOM 提取的数据对缺失字段进行兜底补全（当 initialState 缺失或为空时生效）
            for (let [k, v] of Object.entries(domData)) {
                if (!row[k] && v) {
                    row[k] = v;
                }
            }

            // 基础校验
            if (!row['职位名称'] && !row['公司名称']) {
                console.warn('[Zhilian Scraper] 未能从详情页提取到有效职位名称与公司信息');
            }

            chrome.storage.local.get([
                'zhilian_single_details',
                'zhilian_enrichment_cache',
                'zhilian_company_cache'
            ], (res) => {
                // 1. 保存职位详情至 zhilian_single_details
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
                if (initialState && initialState.jobDeliverList && Array.isArray(initialState.jobDeliverList)) {
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
                const compNumber = row['公司ID'] || (initialState?.jobDetail?.detailedCompany?.companyNumber) || '';
                if (compNumber) {
                    const existingComp = companyCache[compNumber] || {};
                    const compDetailObj = {
                        ...existingComp,
                        ...(initialState?.companyExtDetail || {}),
                        companyNumber: compNumber,
                        companyName: row['公司全称'] || row['公司名称'],
                        legalPerson: row['法定代表人'] || existingComp.legalPerson || '',
                        epType: row['企业类型'] || existingComp.epType || '',
                        createDate: row['成立日期'] || existingComp.createDate || '',
                        epStatus: row['经营状态'] || existingComp.epStatus || '',
                        registeredCapital: row['注册资金'] || existingComp.registeredCapital || '',
                        epCertNo: row['统一社会信用代码'] || existingComp.epCertNo || '',
                        url: row['职位链接'] || existingComp.url || ''
                    };
                    companyCache[compNumber] = compDetailObj;
                    companyCacheUpdated = true;
                }

                let toSet = {
                    'zhilian_single_details': list
                };
                if (cacheUpdated) toSet.zhilian_enrichment_cache = cache;
                if (companyCacheUpdated) toSet.zhilian_company_cache = companyCache;

                chrome.storage.local.set(toSet, () => {
                    showToast(`✅ 智联职位【${row['职位名称'] || jobId}】已成功解析并保存！`);
                    console.log(`[Zhilian Scraper] 职位详情已保存到 zhilian_single_details:`, row);

                    // 同步职位详情到本地服务器
                    fetch('http://localhost:3000/api/job-details', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify([row])
                    }).catch(err => {
                        console.log('[Zhilian Scraper] Local server job detail sync failed:', err);
                    });

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
                });
            });

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

    function injectFloatingButton() {
        if (document.getElementById('zhilian-detail-scraper-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'zhilian-detail-scraper-btn';
        btn.innerHTML = '⚡ 重新抓取本页职位';
        btn.style.cssText = `
            position: fixed;
            bottom: 80px;
            right: 25px;
            z-index: 999999;
            background: linear-gradient(135deg, #00c2b3 0%, #009688 100%);
            color: #ffffff;
            border: none;
            padding: 10px 18px;
            border-radius: 24px;
            font-size: 14px;
            font-weight: bold;
            box-shadow: 0 4px 15px rgba(0, 194, 179, 0.4);
            cursor: pointer;
            transition: all 0.3s ease;
            outline: none;
        `;
        btn.onmouseover = () => { btn.style.transform = 'translateY(-2px) scale(1.05)'; };
        btn.onmouseout = () => { btn.style.transform = 'translateY(0) scale(1)'; };
        btn.onclick = () => {
            btn.innerHTML = '⏳ 抓取中...';
            scrapeSinglePage();
            setTimeout(() => {
                btn.innerHTML = '✅ 抓取完成';
                setTimeout(() => { btn.innerHTML = '⚡ 重新抓取本页职位'; }, 2000);
            }, 1000);
        };
        document.body.appendChild(btn);
    }

    const isJobDetailPage = location.href.includes('/jobdetail/') ||
        (location.host === 'jobs.zhaopin.com' && location.pathname.endsWith('.htm')) ||
        location.href.includes('/jobs/');

    if (isJobDetailPage) {
        setTimeout(() => {
            injectFloatingButton();
            scrapeSinglePage();

            if (location.href.includes('auto_close=1')) {
                setTimeout(() => {
                    window.close();
                    try {
                        chrome.runtime.sendMessage({ action: 'close_current_tab' });
                    } catch (e) { }
                }, 5000);
            }
        }, 1500);
    }
})();
