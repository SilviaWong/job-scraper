(function () {
    'use strict';

    // ==========================================
    // LIEPIN ISOLATED WORLD LOGIC
    // ==========================================

    // --- Worker 模式：详情页 DOM 提取 ---
    // 判断是否是职位详情页，或者是被重定向到了安全中心
    if (window !== window.parent && (location.href.includes('/job/') || location.href.includes('/a/') || location.href.includes('safecenter') || document.title.includes("安全验证"))) {
        console.log("🤖 [Iframe 子脚本] 检测到页面加载，准备提取或检查安全状态...");
        let retries = 0;
        const timer = setInterval(() => {
            retries++;
            // 尝试找 JSON-LD
            let ldJson = null;
            let cambrianJson = null;
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (let s of scripts) {
                try {
                    const parsed = JSON.parse(s.innerHTML.replace(/[\r\n\t]+/g, ' '));
                    if (parsed["@type"] === "JobPosting") {
                        ldJson = parsed;
                    } else if (parsed["@context"] && parsed["@context"].includes("cambrian.jsonld")) {
                        cambrianJson = parsed;
                    }
                } catch (e) { }
            }

            const descNode = document.querySelector('[data-selector="job-intro-content"]');
            const bodyText = document.body.innerText || "";

            // 1. 检测是否触发了安全拦截 (短信验证码)
            if (bodyText.includes("发送短信获取") || bodyText.includes("安全验证") || location.href.includes("safecenter") || document.title.includes("安全拦截")) {
                clearInterval(timer);
                window.parent.postMessage({
                    type: 'LIEPIN_DETAIL_DATA_ERROR',
                    jobId: location.href.match(/\/(?:job|a)\/([a-zA-Z0-9_]+)\.shtml/)?.[1] || location.href,
                    error: "BLOCKED_BY_CAPTCHA"
                }, '*');
                return;
            }

            // 2. 检测职位是否已停止招聘 / 下线
            if (bodyText.includes("职位已停止招聘") || bodyText.includes("该职位已下线") || document.title.includes("停止招聘")) {
                clearInterval(timer);
                window.parent.postMessage({
                    type: 'LIEPIN_DETAIL_DATA_ERROR',
                    jobId: location.href.match(/\/(?:job|a)\/([a-zA-Z0-9_]+)\.shtml/)?.[1] || location.href,
                    error: "职位已停止招聘或下线"
                }, '*');
                return;
            }

            if (ldJson || descNode) {
                clearInterval(timer);

                ldJson = ldJson || {};

                // 收集网页 DOM 上的补充信息
                const domData = {};

                if (cambrianJson) {
                    domData.cambrianPubDate = cambrianJson.pubDate;
                    domData.cambrianUpDate = cambrianJson.upDate;
                }

                const domUpdateTimeNode = document.querySelector('.time-factor-wrap') || document.querySelector('.update-time');
                if (domUpdateTimeNode) domData.domUpdateTime = (domUpdateTimeNode.innerText || "").replace("更新时间：", "").trim();

                if (descNode) {
                    domData.jobDescription = (descNode.innerText || "").trim();
                    // 强制覆盖 JSON 里因解析而丢失换行的描述
                    ldJson.description = domData.jobDescription;
                }

                const salaryNode = document.querySelector('.salary');
                if (salaryNode) domData.salary = (salaryNode.innerText || "").trim();

                const propsNode = document.querySelector('.job-properties');
                if (propsNode) domData.jobProperties = (propsNode.innerText || "").replace(/[\r\n]+/g, ' ').trim();

                const applyNode = document.querySelector('.job-apply-content');
                if (applyNode) domData.jobTags = (applyNode.innerText || "").replace(/[\r\n]+/g, ' ').trim();

                // 专门提取福利标签 (如：五险一金、年底双薪等)
                const welfareLabels = document.querySelectorAll('.job-apply-container-left .labels span');
                if (welfareLabels.length > 0) {
                    domData.welfareTags = Array.from(welfareLabels).map(span => span.innerText.trim()).join(', ');
                }

                const recruiterNode = document.querySelector('.recruiter-container');
                if (recruiterNode) {
                    const infoArray = [];
                    const spans = recruiterNode.querySelectorAll('.name-box .name, .title-box span');
                    spans.forEach(span => {
                        const text = (span.innerText || "").replace(/[\r\n]+/g, ' ').trim();
                        if (text) infoArray.push(text);
                    });
                    domData.recruiterInfo = infoArray;
                }

                const companyIntroNode = document.querySelector('.company-intro-container');
                if (companyIntroNode) domData.companyIntro = (companyIntroNode.innerText || "").trim();

                // 提取所有的 dl 块，过滤出只包含 "其他信息" 的块
                domData.additionalBlocks = [];
                const dlNodes = document.querySelectorAll('dl');
                dlNodes.forEach(dl => {
                    const dt = dl.querySelector('dt');
                    if (dt) {
                        const titleText = (dt.innerText || "").trim();
                        if (titleText === "其他信息") {
                            const dds = dl.querySelectorAll('dd');
                            const contents = Array.from(dds).map(dd => (dd.innerText || "").trim()).filter(Boolean);
                            if (contents.length > 0) {
                                domData.additionalBlocks.push({
                                    title: titleText,
                                    content: contents
                                });
                            }
                        }
                    }
                });

                // 提取公司补充信息 (company-info-container)
                const compInfoNode = document.querySelector('.company-info-container');
                if (compInfoNode) {
                    domData.companyExtraInfo = {};
                    const labelBoxes = compInfoNode.querySelectorAll('.label-box');
                    labelBoxes.forEach(box => {
                        const labelEl = box.querySelector('.label');
                        const textEl = box.querySelector('.text');
                        if (labelEl && textEl) {
                            const label = (labelEl.innerText || "").replace(/：|:/g, "").trim();
                            const text = (textEl.innerText || "").trim();
                            if (label) {
                                domData.companyExtraInfo[label] = text;
                            }
                        }
                    });
                }

                // 提取热门公司 (hot companies)
                const hotCompanies = [];
                const hotLinkNodes = document.querySelectorAll('.common-hot-links-content a, .recommend-company-list a');
                hotLinkNodes.forEach(a => {
                    const compLink = a.href;
                    let compName = "";
                    const nameEl = a.querySelector('.company-name');
                    if (nameEl) {
                        compName = (nameEl.innerText || "").trim();
                    } else {
                        compName = (a.innerText || "").trim();
                    }
                    const match = compLink.match(/\/company\/(\d+)\/?/);
                    if (match && compName) {
                        hotCompanies.push({
                            compId: match[1],
                            compLink: compLink,
                            compName: compName
                        });
                    }
                });
                ldJson.supplementalDomData = domData;

                window.parent.postMessage({
                    type: 'LIEPIN_DETAIL_DATA',
                    jobId: location.href.match(/\/(?:job|a)\/([a-zA-Z0-9_]+)\.shtml/)?.[1] || location.href,
                    detailJson: ldJson,
                    hotCompanies: hotCompanies
                }, '*');
            } else if (retries > 30) { // 等待约 15 秒
                clearInterval(timer);
                window.parent.postMessage({
                    type: 'LIEPIN_DETAIL_DATA_ERROR',
                    jobId: location.href.match(/\/(?:job|a)\/([a-zA-Z0-9_]+)\.shtml/)?.[1] || location.href,
                    error: "Timeout finding job-intro-content"
                }, '*');
            }
        }, 500);
        return; // Worker 不执行 Master 逻辑
    }

    // --- Master 模式 ---
    let isRunning = false;
    let isAutoPage = true;
    let globalJobQueue = [];

    let scrapedData = [];
    let scrapedIds = new Set();
    let sessionProcessedIds = new Set();
    let activeIframe = null;
    let jobsScrapedSinceRest = 0;

    let scrapedCompanies = [];
    let scrapedCompIds = new Set();

    // 工具函数
    function cleanStr(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[\r\n]+/g, ' ').replace(/"/g, '""').replace(/,/g, '，').trim();
    }

    function cleanMultiLineStr(str) {
        if (!str) return '';
        return String(str).replace(/"/g, '""').trim();
    }

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
            newRow['数据来源'] = 'liepin_scraped_data_v1';
            newRow.platform = 'liepin';
            newRow.dataSource = 'liepin_scraped_data_v1';

            fetch('http://localhost:3000/api/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([newRow])
            }).catch(err => {
                console.log('[Liepin Scraper] Local server sync failed (expected if not running):', err);
            });
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

            // 将新抓取到的公司数据推送到本地项目
            fetch('http://localhost:3000/api/companies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newlyAdded)
            }).catch(err => {
                console.log('[Liepin Scraper] Local server company sync failed:', err);
            });
        }
    }

    // 数据查重/更新插入
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

    // 监听 Popup 消息
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'liepin_start') {
            if (window !== window.top) return; // 防止 iframe 内抛出“未发现数据”弹窗
            isAutoPage = request.autoScroll;
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
        }
    });

    // 监听 MAIN World 和 Iframe 拦截到的数据
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'LIEPIN_LIST_DATA') {
            const newList = event.data.data || [];
            let added = 0;
            for (let j of newList) {
                if (!sessionProcessedIds.has(j.job?.jobId)) {
                    globalJobQueue.push(j);
                    sessionProcessedIds.add(j.job?.jobId); // Prevent duplicate push
                    added++;
                }
            }
            console.log(`📥 [隔离层] 接收到猎聘列表数据: ${newList.length} 条，新增入队 ${added} 条，当前队列总计 ${globalJobQueue.length} 条`);
        } else if (event.data && event.data.type === 'LIEPIN_DETAIL_DATA') {
            handleDetailData(event.data.jobId, event.data.detailJson, event.data.hotCompanies);
        } else if (event.data && event.data.type === 'LIEPIN_DETAIL_DATA_ERROR') {
            handleDetailDataError(event.data.jobId, event.data.error);
        }
    });

    // ==========================================
    // 列表页 (Master) 逻辑
    // ==========================================
    function startScraping() {
        if (globalJobQueue.length === 0 && location.host !== 'c.liepin.com') {
            alert('未发现猎聘职位列表数据！请先进行职位搜索或刷新页面。');
            isRunning = false;
            notifyPopupStatus('出错: 无数据');
            return;
        }

        isRunning = true;
        processNext();
    }

    function processNext() {
        if (!isRunning) return;

        // 监控内存，防止由于 DOM 和对象过多导致 Aw, Snap! (Error Code: 5)
        if (performance && performance.memory) {
            const memoryLimit = performance.memory.jsHeapSizeLimit;
            const memoryUsed = performance.memory.usedJSHeapSize;
            const usageRatio = memoryUsed / memoryLimit;
            // 记录内存使用情况，帮助排查问题
            console.log(`[内存监控] 已用: ${(memoryUsed / 1048576).toFixed(1)}MB / 上限: ${(memoryLimit / 1048576).toFixed(1)}MB (${(usageRatio * 100).toFixed(1)}%)`);

            if (usageRatio > 0.85) {
                console.log(`⚠️ 浏览器内存占用过高，即将崩溃！(${usageRatio * 100}%)。正在保存进度并自动刷新页面...`);
                isRunning = false;
                notifyPopupStatus('内存极高，自动刷新重载...');
                if (activeIframe) { activeIframe.src = "about:blank"; activeIframe.remove(); activeIframe = null; }

                // 设置自动重启标识
                chrome.storage.local.set({ 'liepin_auto_resume_v1': { autoScroll: isAutoPage } }, () => {
                    location.reload();
                });
                return;
            }
        }

        if (globalJobQueue.length === 0) {
            if (activeIframe) { activeIframe.src = "about:blank"; activeIframe.remove(); activeIframe = null; }
            if (isAutoPage) {
                goToNextPage();
            } else {
                alert('🎉 队列已空，当前可见职位抓取完毕！');
                isRunning = false;
                notifyPopupStatus('完毕');
            }
            return;
        }

        const currentJobItem = globalJobQueue.shift();
        const job = currentJobItem.job || {};
        const comp = currentJobItem.comp || {};
        const recruiter = currentJobItem.recruiter || {};

        // 查重：如果已经抓取过，直接跳过
        if (scrapedIds.has(String(job.jobId))) {
            console.log(`[查重跳过] 职位 ${job.jobId} 已经存在本地缓存中。`);
            scheduleNextJob();
            return;
        }
        notifyPopupStatus(`队列剩余 ${globalJobQueue.length} 个职位`);

        // 保存原始 JSON 数据，不再做扁平化处理
        const row = {
            ...currentJobItem,
            '平台': 'Liepin',
            '职位ID': job.jobId
        };

        // 模拟人类向下滚动浏览的行为 (平滑滚动到当前职位的卡片)
        try {
            let targetCard = null;
            const jobLinks = Array.from(document.querySelectorAll('a'));
            const currentJobLink = jobLinks.find(a => a.href && a.href.includes(String(job.jobId)));
            if (currentJobLink) {
                // 修复：必须匹配外层的 job-card-pc-container 或 job-list-item，不能只匹配 job-card，因为首页有 job-card-left-box 会导致只高亮左半边
                targetCard = currentJobLink.closest('.job-list-item, [class*="job-card-pc-container"], li') || currentJobLink;
            } else {
                const allSpanElements = Array.from(document.querySelectorAll('div[title], span[title]'));
                const nameEl = allSpanElements.find(el => el.title && el.title.trim() === job.title);
                if (nameEl) {
                    targetCard = nameEl.closest('.job-list-item, [class*="job-card-pc-container"], li') || nameEl;
                }
            }

            if (!targetCard) {
                console.log(`⚠️ [过滤无效职位] 职位 ${job.title} (${job.jobId}) 未在页面渲染，跳过抓取！`);
                setTimeout(processNext, 100);
                return;
            }

            // 保存当前卡片引用，以便后续修改状态颜色
            window.__CURRENT_TARGET_CARD__ = targetCard;

            // 滚动到该职位卡片
            targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // 增加红色的“正在抓取”高亮边框和动画
            targetCard.style.transition = 'all 0.3s ease';
            targetCard.style.boxShadow = '0 0 20px rgba(255, 0, 0, 0.8)';
            targetCard.style.border = '2px solid red';
            targetCard.style.transform = 'scale(1.02)';

        } catch (e) { }

        // 创建 iframe 进行深层提取
        if (activeIframe) { activeIframe.src = 'about:blank'; activeIframe.remove(); }
        activeIframe = document.createElement('iframe');
        activeIframe.style.cssText = 'position: fixed; right: 20px; bottom: 20px; width: 600px; height: 500px; z-index: 99999999; border: 3px solid #ff9800; background: white; box-shadow: 0 0 15px rgba(0,0,0,0.3); border-radius: 8px;';

        // 组装详情页链接
        const detailUrl = job.link ? job.link.split('?')[0] : `https://www.liepin.com/job/${job.jobId}.shtml`;
        activeIframe.src = detailUrl;

        window.__CURRENT_PROCESSING_ROW__ = row;
        document.body.appendChild(activeIframe);

        // 设置 iframe 超时 (如果是已下线职位或真的反爬，我们记录失败并跳过，不强行中断整个任务)
        window.__CURRENT_IFRAME_TIMEOUT__ = setTimeout(() => {
            console.warn(`[超时报警] 职位 ${job.jobId} 提取失败，可能已停止招聘或触发反爬。`);
            handleDetailDataError(job.jobId);
        }, 15000); // 15秒超时
    }

    function handleDetailData(jobId, detailJson, hotCompanies) {
        if (window.__CURRENT_IFRAME_TIMEOUT__) {
            clearTimeout(window.__CURRENT_IFRAME_TIMEOUT__);
            window.__CURRENT_IFRAME_TIMEOUT__ = null;
        }

        const row = window.__CURRENT_PROCESSING_ROW__ || {};
        const comp = row.comp || {};
        let compsToSave = hotCompanies || [];

        // 提取主要公司（含代招猎头公司）保存到数据库
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
            console.log(`✅ [猎聘已抓取] ${row['职位名称']} (含深层描述)`);
            scheduleNextJob();
        });
    }

    function handleDetailDataError(jobId, errorReason) {
        if (!isRunning) return;

        // 如果是因为触发了验证码拦截，必须彻底停止抓取！
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

        const row = window.__CURRENT_PROCESSING_ROW__ || {};
        row.jobDetailJson = { description: "提取超时、提取失败或该职位已下线停止招聘" };
        row['职位描述'] = "提取超时、提取失败或该职位已下线停止招聘";

        if (window.__CURRENT_TARGET_CARD__) {
            window.__CURRENT_TARGET_CARD__.style.boxShadow = '0 0 20px rgba(128, 128, 128, 0.8)';
            window.__CURRENT_TARGET_CARD__.style.border = '2px solid gray';
        }

        upsertData(row['职位ID'], row, () => {
            console.log(`⚠️ [猎聘跳过] ${row['职位名称'] || jobId} (已记录为提取失败/下线)`);
            scheduleNextJob();
        });
    }

    function scheduleNextJob() {
        if (!isRunning) return;
        jobsScrapedSinceRest++;

        let delay = getRandomInt(1000, 2000);
        // 模拟人类休息
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
        if (location.host === 'c.liepin.com') {
            notifyPopupStatus('向下滚动寻找更多数据...');

            // 瀑布流：循环滚动到底部直到数据到来
            let scrollAttempts = 0;
            const scrollInterval = setInterval(() => {
                if (!isRunning) {
                    clearInterval(scrollInterval);
                    return;
                }

                if (globalJobQueue.length > 0) {
                    clearInterval(scrollInterval);
                    processNext();
                    return;
                }

                window.scrollBy({ top: 1500, behavior: 'smooth' });
                scrollAttempts++;

                if (scrollAttempts > 10) { // 大约30秒没刷出新数据
                    clearInterval(scrollInterval);
                    alert('🎉 连续多次滚动未发现新数据，可能是已到底部或网络超时。');
                    isRunning = false;
                    notifyPopupStatus('完毕或超时');
                }
            }, 3000);

        } else {
            // 传统翻页
            const nextBtn = document.querySelector('li[title="下一页"]') || document.querySelector('.ant-pagination-next');
            if (nextBtn && !nextBtn.className.includes('ant-pagination-disabled') && nextBtn.querySelector('button') && !nextBtn.querySelector('button').disabled) {
                notifyPopupStatus('正在翻页...');

                // 点击下一步
                const clickEl = nextBtn.querySelector('a') || nextBtn.querySelector('button') || nextBtn;
                clickEl.click();

                // 等待新数据进入队列
                setTimeout(() => {
                    const checkData = setInterval(() => {
                        if (!isRunning) {
                            clearInterval(checkData);
                            return;
                        }
                        if (globalJobQueue.length > 0) {
                            clearInterval(checkData);
                            processNext();
                        }
                    }, 1000);

                    // 15秒都没刷出新数据就算了
                    setTimeout(() => {
                        if (globalJobQueue.length === 0 && isRunning) {
                            clearInterval(checkData);
                            notifyPopupStatus('翻页超时');
                            isRunning = false;
                        }
                    }, 15000);
                }, 3000);
            } else {
                alert('🎉 所有可用页面均已抓取完毕，或已到达最后一页！');
                isRunning = false;
                notifyPopupStatus('全部完毕');
            }
        }
    }

    // ==========================================
    // 自动续传初始化 (防止刷新后中断)
    // ==========================================
    if (window === window.top) {
        chrome.storage.local.get(['liepin_auto_resume_v1'], (result) => {
            if (result && result.liepin_auto_resume_v1) {
                const resumeData = result.liepin_auto_resume_v1;
                // 清理标记，防止陷入无限死循环刷新
                chrome.storage.local.remove('liepin_auto_resume_v1');

                console.log("🔄 [自动续传] 检测到因内存清理触发的刷新，3秒后自动恢复抓取...");
                // 延迟 3 秒启动，等待页面基本元素和网络请求加载完成
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

    // === 详情页自动探测职位关闭 ===
    if (window.location.href.includes('liepin.com/job/') || window.location.href.includes('liepin.com/a/')) {
        setTimeout(() => {
            const bodyText = document.body.innerText || "";
            const isClosed = bodyText.includes('职位已停止招聘') ||
                bodyText.includes('职位已关闭') ||
                bodyText.includes('很抱歉，你所访问的页面不存在') ||
                bodyText.includes('职位已下线') ||
                bodyText.includes('职位不存在');

            // if (isClosed) {
            //     const m = location.href.match(/\/(?:job|a)\/([^.?#]+)\.s?html/);
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
