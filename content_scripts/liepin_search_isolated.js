(function () {
    'use strict';

    // ==========================================
    // LIEPIN SEARCH ISOLATED WORLD LOGIC (Master & Worker Mode for www.liepin.com)
    // ==========================================

    const isMaster = window.self === window.top && window.location.href.includes('liepin.com/zhaopin');
    const isDetail = location.href.includes('/job/') || location.href.includes('/a/') || location.href.includes('safecenter') || document.title.includes("安全验证");
    const isIframe = window !== window.top;

    // --- 字符串与时间清洗工具函数 (参考 Boss 直聘对齐) ---
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
            activeTime = `${yyyy}-${mm}-${dd}`;
        }
        return activeTime;
    }

    // 页面提示 Toast
    function showToast(msg) {
        if (isIframe) return; // iframe 内不显示 Toast，避免干扰
        const div = document.createElement('div');
        div.textContent = msg;
        div.style.cssText = `
            position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
            background: #ff7f00; color: white; padding: 12px 24px;
            border-radius: 8px; z-index: 99999999; font-size: 15px; font-weight: bold; pointer-events: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.25); transition: opacity 0.5s;
        `;
        document.body.appendChild(div);
        setTimeout(() => {
            div.style.opacity = '0';
            setTimeout(() => div.remove(), 500);
        }, 3000);
    }

    // --- 详情页数据解析函数 ---
    function parseLiepinDetailPage() {
        const bodyText = document.body.innerText || "";

        // 1. 安全拦截检测
        const isBlocked = bodyText.includes("发送短信获取") || bodyText.includes("安全验证") || location.href.includes("safecenter") || document.title.includes("安全拦截");
        if (isBlocked) {
            return { isBlocked: true, isClosed: false };
        }

        // 2. 职位停招/下线检测
        const isClosed = bodyText.includes("职位已停止招聘") || bodyText.includes("该职位已下线") || document.title.includes("停止招聘") || bodyText.includes("该职位已暂停招聘") || bodyText.includes("职位已关闭") || bodyText.includes("很抱歉，你所访问的页面不存在") || bodyText.includes("职位不存在");

        // 3. 提取 JSON-LD 与 cambrian.jsonld
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
        ldJson = ldJson || {};

        // 3.1 提取猎聘官方内嵌全局配置 var $CONFIG = { ... }
        let pageConfig = {};
        try {
            const allScripts = document.querySelectorAll('script');
            for (let i = 0; i < allScripts.length; i++) {
                const sText = allScripts[i].textContent || allScripts[i].innerText || '';
                if (sText.includes('$CONFIG') && sText.includes('jobId')) {
                    const match = sText.match(/\$CONFIG\s*=\s*(\{[\s\S]*?\});/);
                    if (match) {
                        try {
                            pageConfig = JSON.parse(match[1]);
                        } catch (err) {
                            pageConfig = (new Function(`return ${match[1]}`))();
                        }
                        break;
                    }
                }
            }
        } catch (e) {
            console.warn("提取猎聘 $CONFIG 失败:", e);
        }

        // 4. 提取职位 ID (优先使用权威的 $CONFIG.jobId)
        let jobId = '';
        if (pageConfig.jobId) {
            jobId = String(pageConfig.jobId);
        } else {
            const m = location.href.match(/\/(?:job|a)\/([a-zA-Z0-9_]+)\.s?html/);
            jobId = m ? m[1] : (ldJson.identifier || `ID_${Date.now()}`);
        }

        // 5. 提取补充 DOM 数据
        const domData = {};
        domData.pageConfig = pageConfig;
        if (cambrianJson) {
            domData.cambrianPubDate = cambrianJson.pubDate;
            domData.cambrianUpDate = cambrianJson.upDate;
        }

        const domUpdateTimeNode = document.querySelector('.time-factor-wrap') || document.querySelector('.update-time');
        if (domUpdateTimeNode) domData.domUpdateTime = (domUpdateTimeNode.innerText || "").replace("更新时间：", "").trim();

        const descNode = document.querySelector('[data-selector="job-intro-content"]') ||
            document.querySelector('.job-intro-content') ||
            document.querySelector('.job-intro') ||
            document.querySelector('.job-description') ||
            document.querySelector('.job-detail') ||
            document.querySelector('.job-desc') ||
            document.querySelector('div[class*="job-intro"]') ||
            document.querySelector('div[class*="job-desc"]');

        let rawDesc = descNode ? (descNode.innerText || "").trim() : (ldJson.description || "");
        if (isClosed && !rawDesc) {
            rawDesc = "该职位已停止招聘或下线";
        }
        ldJson.description = rawDesc;

        const salaryNode = document.querySelector('.salary') || document.querySelector('.job-apply-container-left .salary');
        if (salaryNode) domData.salary = cleanStr(salaryNode.textContent);

        const propsNode = document.querySelector('.job-properties') || document.querySelector('.job-apply-container-left .labels');
        let propTexts = [];
        if (propsNode) {
            const spans = propsNode.querySelectorAll('span');
            if (spans.length > 0) {
                propTexts = Array.from(spans).map(s => cleanStr(s.textContent)).filter(Boolean);
            } else {
                propTexts = cleanStr(propsNode.textContent).split(/[\s·/]+/).filter(Boolean);
            }
            domData.jobProperties = propTexts.join(' / ');
        }

        const welfareLabels = document.querySelectorAll('.job-apply-container-left .labels span, .welfare-list span');
        if (welfareLabels.length > 0) {
            domData.welfareTags = Array.from(welfareLabels).map(span => cleanStr(span.textContent)).filter(Boolean).join(', ');
        }

        const recruiterNode = document.querySelector('.recruiter-container');
        if (recruiterNode) {
            const infoArray = [];
            const spans = recruiterNode.querySelectorAll('.name-box .name, .recruiter-name, .title-box span, .recruiter-title');
            spans.forEach(span => {
                const text = cleanStr(span.textContent);
                if (text) infoArray.push(text);
            });
            domData.recruiterInfo = infoArray;
        }

        const companyIntroNode = document.querySelector('.company-intro-container');
        if (companyIntroNode) domData.companyIntro = cleanStr(companyIntroNode.textContent);

        domData.additionalBlocks = [];
        const dlNodes = document.querySelectorAll('dl');
        dlNodes.forEach(dl => {
            const dt = dl.querySelector('dt');
            if (dt) {
                const titleText = cleanStr(dt.textContent);
                if (titleText === "其他信息") {
                    const dds = dl.querySelectorAll('dd');
                    const contents = Array.from(dds).map(dd => cleanStr(dd.textContent)).filter(Boolean);
                    if (contents.length > 0) {
                        domData.additionalBlocks.push({ title: titleText, content: contents });
                    }
                }
            }
        });

        const compInfoNode = document.querySelector('.company-info-container');
        if (compInfoNode) {
            domData.companyExtraInfo = {};
            const labelBoxes = compInfoNode.querySelectorAll('.label-box');
            labelBoxes.forEach(box => {
                const labelEl = box.querySelector('.label');
                const textEl = box.querySelector('.text');
                if (labelEl && textEl) {
                    const label = cleanStr(labelEl.textContent).replace(/[:：]/g, "");
                    const text = cleanStr(textEl.textContent);
                    if (label) domData.companyExtraInfo[label] = text;
                }
            });
        }

        const hotCompanies = [];
        const hotLinkNodes = document.querySelectorAll('.common-hot-links-content a, .recommend-company-list a');
        hotLinkNodes.forEach(a => {
            const compLink = a.href;
            let cName = "";
            const nameEl = a.querySelector('.company-name');
            if (nameEl) {
                cName = cleanStr(nameEl.textContent);
            } else {
                cName = cleanStr(a.textContent);
            }
            const match = compLink.match(/\/company\/(\d+)\/?/);
            if (match && cName) {
                hotCompanies.push({
                    compId: match[1],
                    compLink: compLink,
                    compName: cName
                });
            }
        });
        ldJson.supplementalDomData = domData;

        // 6. 综合各维度字段构造标准化职位行
        const jobTitle = cleanStr(document.querySelector('h1[data-selector="job-intro-title"]')?.textContent || document.querySelector('.job-apply-container-left .title-box h1')?.textContent || document.querySelector('.job-title-box h1')?.textContent || document.querySelector('h1.name')?.textContent || ldJson?.title || document.querySelector('h1')?.textContent);
        const salary = domData.salary || cleanStr(ldJson?.baseSalary) || '';

        let workLocation = '';
        let workExp = '';
        let eduReq = '';

        propTexts.forEach(p => {
            if (p.includes('年') || p.includes('经验') || p.includes('应届') || p.includes('在读')) {
                if (!workExp) workExp = p;
            } else if (p.includes('专科') || p.includes('大专') || p.includes('本科') || p.includes('硕士') || p.includes('博士') || p.includes('中专') || p.includes('高中') || p.includes('学历')) {
                if (!eduReq) eduReq = p;
            } else if (!workLocation) {
                workLocation = p;
            }
        });

        if (!workLocation && ldJson.jobLocation) {
            const addr = ldJson.jobLocation.address || ldJson.jobLocation;
            workLocation = cleanStr(addr.addressLocality || addr.addressRegion || '');
        }
        if (!workExp && ldJson.experienceRequirements) workExp = cleanStr(ldJson.experienceRequirements);
        if (!eduReq && (ldJson.educationRequirements || ldJson.educationalLevel)) eduReq = cleanStr(ldJson.educationRequirements || ldJson.educationalLevel);

        let hrName = '';
        let hrTitle = '';
        let hrActive = '';
        let hrCompany = '';
        if (recruiterNode) {
            hrName = cleanStr(recruiterNode.querySelector('.name-box .name, .recruiter-name')?.textContent);
            hrTitle = cleanStr(recruiterNode.querySelector('.title-box span, .recruiter-title')?.textContent);
            hrActive = formatActiveTime(recruiterNode.querySelector('.active-time, .status-box, .recruiter-status, .time, .online-tag')?.textContent);
            if (domData.recruiterInfo && domData.recruiterInfo.length >= 3) {
                hrCompany = domData.recruiterInfo[2].replace(/^[·\s]+/, '').trim();
            }
        }

        let compName = pageConfig.compName || cleanStr(compInfoNode?.querySelector('.company-name')?.textContent || document.querySelector('.company-intro-container .company-name')?.textContent || document.querySelector('.job-apply-container-left .company-name')?.textContent || ldJson?.hiringOrganization?.name);
        let compFullName = (domData.companyExtraInfo && domData.companyExtraInfo['企业全称']) || (domData.companyExtraInfo && domData.companyExtraInfo['公司全称']) || compName;
        let compIndustry = (domData.companyExtraInfo && domData.companyExtraInfo['企业行业']) || (domData.companyExtraInfo && domData.companyExtraInfo['行业']) || cleanStr(ldJson?.industry);
        let compScale = (domData.companyExtraInfo && domData.companyExtraInfo['企业规模']) || (domData.companyExtraInfo && domData.companyExtraInfo['规模']) || '';
        let compType = (domData.companyExtraInfo && domData.companyExtraInfo['企业性质']) || (domData.companyExtraInfo && domData.companyExtraInfo['类型']) || '';

        // 优先从官方 $CONFIG.compId 提取公司 ID，次选 hiringOrganization.sameAs，彻底避免误取右侧推荐公司
        let compId = '';
        if (pageConfig.compId) {
            compId = String(pageConfig.compId);
        } else if (ldJson?.hiringOrganization?.sameAs) {
            const mC = ldJson.hiringOrganization.sameAs.match(/\/company\/(\d+)\/?/);
            if (mC) compId = mC[1];
        }
        if (!compId) {
            const compLinkEl = document.querySelector('.company-info-container a[href*="/company/"]') ||
                               document.querySelector('.company-intro-container a[href*="/company/"]') ||
                               document.querySelector('.job-apply-container-left a[href*="/company/"]');
            if (compLinkEl) {
                const mC = compLinkEl.href.match(/\/company\/(\d+)\/?/);
                if (mC) compId = mC[1];
            }
        }

        // 岗位性质与代招类型
        const jobKind = pageConfig.jobKind != null ? String(pageConfig.jobKind) : '';
        const isProxy = (jobKind === "1" || hrCompany.includes('人力') || hrCompany.includes('猎头'));
        const jobTypeProxy = isProxy ? '猎头/代招' : '';
        const hrId = pageConfig.jobOwnerId ? String(pageConfig.jobOwnerId) : '';
        const traceId = (pageConfig.traceId && typeof pageConfig.traceId === 'object') ? (pageConfig.traceId.initial || '') : (pageConfig.traceId || '');

        // 详细完整地址 (优先门牌，若无门牌且与工作地点重复则保持纯净)
        let compAddress = cleanStr(document.querySelector('.job-address, .work-address, .location-address')?.textContent || (ldJson?.jobLocation?.address?.streetAddress) || '');

        let fullDescription = cleanMultiLineStr(rawDesc);
        if (domData.additionalBlocks && domData.additionalBlocks.length > 0) {
            domData.additionalBlocks.forEach(b => {
                if (b.title && b.content && b.content.length > 0) {
                    fullDescription += `\n\n【${b.title}】\n` + b.content.join('\n');
                }
            });
        }

        // 技能标签精准提取与去重（彻底排除标题、薪资、地点、经验、学历及状态词）
        const excludeSet = new Set([
            jobTitle,
            salary,
            workLocation,
            workExp,
            eduReq,
            '招1人', '招若干人', '招人', '今日更新', '前更新', '更新', '招聘中', '猎聘'
        ]);
        propTexts.forEach(p => excludeSet.add(p));

        const skillElements = document.querySelectorAll('.job-intro-keyword span, [data-selector="job-intro-keyword"] span, .tag-box span, .tag-list span, .job-keyword-list li');
        const skillSet = new Set();
        skillElements.forEach(el => {
            if (el.closest('h1, .salary, .job-properties, .recruiter-container, .company-info-container')) return;
            const txt = cleanStr(el.textContent);
            if (!txt || excludeSet.has(txt)) return;
            if (/\d+[-~]\d+[kK]|\d+薪/.test(txt)) return;
            if (/\d+年|应届|专科|大专|本科|硕士|博士|招\d+人|更新/.test(txt)) return;
            skillSet.add(txt);
        });
        const skills = Array.from(skillSet).join(',');

        const pageUpdateTime = domData.domUpdateTime || '';
        const lastRefreshTime = (cambrianJson && (cambrianJson.upDate || cambrianJson.pubDate)) || ldJson.datePosted || '';

        const row = {
            '职位ID': jobId,
            '平台': 'liepin',
            '数据来源': 'liepin_single_details',
            'platform': 'liepin',
            'dataSource': 'liepin_single_details',
            '职位名称': jobTitle,
            '招聘状态': isClosed ? '已下线' : '招聘中',
            '薪资待遇': salary,
            '工作地点': workLocation,
            '工作经验': workExp,
            '学历要求': eduReq,
            '职位描述': fullDescription,
            '技能标签': skills,
            'HR_ID': hrId,
            'HR姓名': hrName,
            'HR职位': hrTitle,
            'HR活跃度': hrActive,
            'HR所属公司': hrCompany,
            '岗位类型_外包猎头': jobTypeProxy,
            'jobKind': jobKind,
            '公司名称': compName,
            '公司全称': compFullName,
            '公司行业': compIndustry,
            '公司规模': compScale,
            '公司福利': domData.welfareTags || '',
            '法定代表人': (domData.companyExtraInfo && domData.companyExtraInfo['法定代表人']) || '',
            '成立日期': (domData.companyExtraInfo && (domData.companyExtraInfo['成立日期'] || domData.companyExtraInfo['注册时间'])) || '',
            '企业类型': compType,
            '经营状态': (domData.companyExtraInfo && domData.companyExtraInfo['经营状态']) || '',
            '注册资金': (domData.companyExtraInfo && domData.companyExtraInfo['注册资本']) || '',
            '公司ID': compId,
            '详细完整地址': compAddress,
            '页面更新时间': pageUpdateTime,
            '最后刷新时间': lastRefreshTime,
            '精确更新时间': pageUpdateTime || lastRefreshTime,
            '抓取时间': new Date().toLocaleString(),
            'pageConfig': pageConfig,
            'traceId': traceId,
            'jobDetail': ldJson
        };

        return {
            row,
            jobId,
            ldJson,
            hotCompanies,
            isClosed,
            isBlocked
        };
    }

    // --- 保存详情至 liepin_single_details 影子库与企业库 ---
    function saveLiepinSingleDetail(row, hotCompanies = [], isSilent = false) {
        const jobId = row['职位ID'];
        chrome.storage.local.get(['liepin_single_details', 'liepin_companies_db_v1'], (res) => {
            const list = res.liepin_single_details || [];
            const idx = list.findIndex(item => item['职位ID'] === jobId);
            if (idx >= 0) {
                list[idx] = row;
            } else {
                list.push(row);
            }

            // 同步企业库
            let compList = res.liepin_companies_db_v1 || [];
            const newlyAddedComps = [];
            const cId = row['公司ID'];
            const cFullName = row['公司全称'] || row['公司名称'];

            let currentCompData = null;
            if (cId || cFullName) {
                const compData = {
                    compId: cId || '',
                    '公司ID': cId || '',
                    compName: row['公司名称'] || '',
                    '公司名称': row['公司名称'] || '',
                    compFullName: cFullName || '',
                    '公司全称': cFullName || '',
                    compIndustry: row['公司行业'] || '',
                    '公司行业': row['公司行业'] || '',
                    compScale: row['公司规模'] || '',
                    '公司规模': row['公司规模'] || '',
                    compType: row['企业类型'] || '',
                    '企业类型': row['企业类型'] || '',
                    compAddress: row['详细完整地址'] || '',
                    '详细完整地址': row['详细完整地址'] || '',
                    platform: 'liepin',
                    '平台': 'liepin',
                    sourcePlatform: '猎聘',
                    dataSource: 'liepin_single_details_company_card',
                    '数据来源': 'liepin_single_details_company_card',
                    '抓取时间': row['抓取时间'] || new Date().toLocaleString(),
                    updateTime: new Date().toLocaleString()
                };
                currentCompData = compData;
                const cIdx = compList.findIndex(c => (cId && String(c.compId) === String(cId)) || (!cId && (c.compFullName === cFullName || c.compName === cFullName)));
                if (cIdx >= 0) {
                    compList[cIdx] = { ...compList[cIdx], ...compData };
                } else {
                    compData.createTime = compData.updateTime;
                    compList.push(compData);
                    newlyAddedComps.push(compData);
                }
            }

            if (hotCompanies && hotCompanies.length > 0) {
                hotCompanies.forEach(h => {
                    if (h.compId && !compList.some(c => String(c.compId) === String(h.compId))) {
                        const hotData = {
                            compId: String(h.compId),
                            compName: h.compName,
                            compFullName: h.compName,
                            compLink: h.compLink,
                            platform: 'liepin',
                            dataSource: 'liepin_companies_db_v1',
                            '平台': 'liepin',
                            '数据来源': 'liepin_companies_db_v1',
                            createTime: new Date().toLocaleString(),
                            updateTime: new Date().toLocaleString()
                        };
                        compList.push(hotData);
                        newlyAddedComps.push(hotData);
                    }
                });
            }

            chrome.storage.local.set({
                'liepin_single_details': list,
                'liepin_companies_db_v1': compList
            }, () => {
                if (!isSilent) {
                    showToast('✅ 猎聘职位详情已自动抓取，关键数据已同步至主库！');
                }
                console.log(`[Liepin Scraper] 职位详情已保存到 liepin_single_details: ${row['职位名称']} (${jobId})`);
            });

            // 同步职位详情到本地服务器（同时挂载独立的纯净企业卡片数据 companyCard，供服务端写入 Company.rawData3）
            const rowToSync = {
                ...row,
                companyCard: currentCompData
            };
            fetch('http://localhost:3000/api/job-details', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([rowToSync])
            }).catch(err => {
                console.log('[Liepin Scraper] Local server single detail sync failed (expected if not running):', err);
            });
        });
    }

    // --- 详情页抓取主入口 ---
    if (isDetail && !isMaster) {
        if (isIframe) {
            // === 模式 1: iframe 模式 (搜索页批量抓取 worker) ===
            console.log("🤖 [Liepin Detail Worker] iframe 模式详情页面加载，准备提取...");
            const startTime = Date.now();
            const timer = setInterval(() => {
                const parsed = parseLiepinDetailPage();
                if (parsed.isBlocked) {
                    clearInterval(timer);
                    window.parent.postMessage({
                        type: 'LIEPIN_DETAIL_DATA_ERROR',
                        jobId: location.href.match(/\/(?:job|a)\/([a-zA-Z0-9_]+)\.shtml/)?.[1] || location.href,
                        error: "BLOCKED_BY_CAPTCHA"
                    }, '*');
                    return;
                }
                if (parsed.isClosed) {
                    clearInterval(timer);
                    window.parent.postMessage({
                        type: 'LIEPIN_DETAIL_DATA_ERROR',
                        jobId: parsed.jobId,
                        error: "OFFLINE"
                    }, '*');
                    return;
                }

                if (parsed.row && (parsed.row['职位描述'] || (parsed.ldJson && parsed.ldJson.description))) {
                    clearInterval(timer);
                    // 存储至影子库
                    saveLiepinSingleDetail(parsed.row, parsed.hotCompanies, true);
                    window.parent.postMessage({
                        type: 'LIEPIN_DETAIL_DATA',
                        jobId: parsed.jobId,
                        detailJson: parsed.ldJson,
                        hotCompanies: parsed.hotCompanies
                    }, '*');
                } else if (Date.now() - startTime > 15000) {
                    clearInterval(timer);
                    window.parent.postMessage({
                        type: 'LIEPIN_DETAIL_DATA_ERROR',
                        jobId: location.href.match(/\/(?:job|a)\/([a-zA-Z0-9_]+)\.shtml/)?.[1] || location.href,
                        error: "Timeout finding job description"
                    }, '*');
                }
            }, 500);
            return;
        } else {
            // === 模式 2: 独立标签页模式 (参考 BOSS 直聘独立职位抓取) ===
            console.log("🤖 [Liepin Single Detail] 独立职位详情页面加载，2秒后自动提取数据...");
            setTimeout(() => {
                try {
                    const parsed = parseLiepinDetailPage();
                    if (parsed.isBlocked) {
                        console.warn("⚠️ [Liepin Detail] 遇到安全拦截或短信验证，暂缓抓取");
                        showToast("⚠️ 猎聘提示安全验证，请先在页面完成验证");
                        return;
                    }

                    if (parsed.row) {
                        saveLiepinSingleDetail(parsed.row, parsed.hotCompanies, false);
                    }

                    // 兼容通过外部自动化脚本调用并传递 auto_close=1 的场景 (参考 Boss 直聘)
                    if (location.href.includes('auto_close=1')) {
                        console.log("[Liepin Single Detail] 检测到 auto_close=1，5秒后自动关闭当前标签页...");
                        setTimeout(() => {
                            window.close();
                            try {
                                chrome.runtime.sendMessage({ action: 'close_current_tab' });
                            } catch (e) { }
                        }, 5000);
                    }
                } catch (err) {
                    console.error("[Liepin Single Detail] 抓取职位详情报错:", err);
                    showToast('❌ 抓取报错: ' + err.message);
                }
            }, 2000);
            return;
        }
    }

    // --- Master 模式 ---
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
            newRow['数据来源'] = 'liepin_search_data';
            newRow.platform = 'liepin';
            newRow.dataSource = 'liepin_search_data';

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
                // 如果本地服务器未开启，这里会忽略错误，不影响原有逻辑
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
            //     // 如果远程服务器未开启，这里会忽略错误，不影响原有逻辑
            //     console.log('[Liepin Scraper] Remote server company sync failed (expected if not running):', err);
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
            console.log(`📥 [搜索隔离层] 接收到猎聘列表数据: ${newList.length} 条，新增入队 ${added} 条，当前队列总计 ${globalJobQueue.length} 条`);
        } else if (event.data && event.data.type === 'LIEPIN_DETAIL_DATA') {
            handleDetailData(event.data.jobId, event.data.detailJson, event.data.hotCompanies);
        } else if (event.data && event.data.type === 'LIEPIN_DETAIL_DATA_ERROR') {
            handleDetailDataError(event.data.jobId, event.data.error);
        }
    });

    function startScraping() {
        const cards = Array.from(document.querySelectorAll('[data-tlg-elem-id="c_pc_search_job_listcard"], .job-list-item, [class*="job-card-pc-container"]'));
        domCardQueue = [];
        let missingJsonCount = 0;

        for (let c of cards) {
            // 过滤掉页面上隐藏的无效/下线职位卡片 (display: none)
            if (c.offsetWidth === 0 && c.offsetHeight === 0) {
                console.log('⚠️ [过滤隐藏卡片] 发现并跳过一个页面上被隐藏的职位卡片');
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
                 alert('未发现猎聘职位数据！请先进行职位搜索或刷新页面。');
                 isRunning = false;
                 notifyPopupStatus('出错: 无数据');
                 return;
            }
        }

        console.log(`[DOM扫描] 页面共找到 ${domCardQueue.length} 个职位卡片，其中 ${missingJsonCount} 个缺失JSON数据。`);

        currentCardIndex = 0;
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
                globalJobQueue = []; 
                goToNextPage();
            } else {
                alert('🎉 当前页面职位抓取完毕！');
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
            console.log(`✅ [猎聘已抓取] ${row['职位名称']} (含深层描述)`);
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
        const nextBtn = document.querySelector('li[title="下一页"]') || document.querySelector('.ant-pagination-next');
        if (nextBtn && !nextBtn.className.includes('ant-pagination-disabled') && nextBtn.querySelector('button') && !nextBtn.querySelector('button').disabled) {
            notifyPopupStatus('正在翻页...');

            const clickEl = nextBtn.querySelector('a') || nextBtn.querySelector('button') || nextBtn;
            clickEl.click();

            setTimeout(() => {
                const checkData = setInterval(() => {
                    if (!isRunning) {
                        clearInterval(checkData);
                        return;
                    }
                    if (globalJobQueue.length > 0) {
                        clearInterval(checkData);
                        // 延迟等待 React 将拦截到的 JSON 渲染成实际的 DOM 卡片
                        setTimeout(() => {
                            if (isRunning) {
                                startScraping();
                            }
                        }, 2000);
                    }
                }, 1000);

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
