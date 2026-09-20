/**
 * BOSS直聘公司主页独立抓取数据脚本
 * 运行环境: ISOLATED world
 * 匹配路径: *://*.zhipin.com/gongsi/*
 */
(function () {
    'use strict';

    if (window !== window.parent) return; // 避免在 iframe 中重复执行

    console.log('[Boss Company Scraper] 脚本已加载，准备检测公司主页:', location.href);

    // ==========================================
    // 工具函数
    // ==========================================

    function cleanStr(str) {
        if (str == null) return '';
        if (Array.isArray(str)) str = str.join(' / ');
        return String(str)
            .replace(/[\r\n\t]+/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .replace(/"/g, '""')
            .trim();
    }

    function cleanMultiLineStr(str) {
        if (str == null) return '';
        if (Array.isArray(str)) str = str.join('\n');
        return String(str)
            .replace(/\r\n/g, '\n')
            .replace(/"/g, '""')
            .trim();
    }

    function showToast(message, isSuccess = true) {
        try {
            const toastId = '__boss_company_scraper_toast__';
            let toast = document.getElementById(toastId);
            if (!toast) {
                toast = document.createElement('div');
                toast.id = toastId;
                toast.style.cssText = `
                    position: fixed;
                    bottom: 30px;
                    right: 30px;
                    z-index: 9999999;
                    padding: 12px 20px;
                    border-radius: 8px;
                    font-size: 14px;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
                    box-shadow: 0 4px 16px rgba(0,0,0,0.18);
                    transition: all 0.3s ease;
                    pointer-events: none;
                    font-weight: 500;
                `;
                document.body.appendChild(toast);
            }
            toast.style.backgroundColor = isSuccess ? '#00bebd' : '#ff4d4f';
            toast.style.color = '#ffffff';
            toast.innerText = message;
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';

            setTimeout(() => {
                if (toast) {
                    toast.style.opacity = '0';
                    toast.style.transform = 'translateY(12px)';
                }
            }, 3500);
        } catch (e) {
            console.error('[Boss Company Scraper] Toast error:', e);
        }
    }

    // ==========================================
    // 核心提取逻辑
    // ==========================================

    function isCompanyPage() {
        return /\/gongsi\/[a-zA-Z0-9_~-]+\.html/.test(location.pathname);
    }

    function extractInlineScriptData() {
        const result = {};
        try {
            const scripts = document.querySelectorAll('script:not([src])');
            for (let s of scripts) {
                const text = s.innerHTML || '';
                if (text.includes('brand_id')) {
                    const match = text.match(/brand_id\s*:\s*['"]([^'"]+)['"]/);
                    if (match) result.brandId = match[1];
                }
            }
        } catch (e) {}
        return result;
    }

    function extractCompanyData() {
        const inlineData = extractInlineScriptData();

        // 1. 公司ID (brandId / companyId)
        let companyId = inlineData.brandId || '';
        if (!companyId) {
            const match = location.pathname.match(/\/gongsi\/(?:job\/)?([^.?#]+)\.html/);
            if (match) companyId = match[1];
        }

        // 2. 公司名称 (简称) 与 Logo
        let companyName = '';
        const nameEl = document.querySelector('.info-primary .info .name') || document.querySelector('.smallbanner .name');
        if (nameEl) {
            // 剔除内部的收藏、图标等元素文本
            const clone = nameEl.cloneNode(true);
            const focusBtn = clone.querySelector('.icon-focus');
            if (focusBtn) focusBtn.remove();
            const brandIcon = clone.querySelector('.icon-brand');
            if (brandIcon) brandIcon.remove();
            companyName = cleanStr(clone.textContent);
        }

        const logoEl = document.querySelector('.info-primary img.fl') || document.querySelector('.smallbanner img.fl');
        let logo = logoEl ? logoEl.src : '';
        // 获取无压缩/去缩放的原图
        if (logo && logo.includes('?x-oss-process')) {
            logo = logo.split('?')[0];
        }

        // 3. 融资阶段、人员规模、所属行业
        let stage = '';
        let scale = '';
        let industry = '';
        let industryCode = '';

        const primaryP = document.querySelector('.info-primary .info p');
        if (primaryP) {
            const indLink = primaryP.querySelector('a.industry-link');
            if (indLink) {
                industry = cleanStr(indLink.textContent);
                const codeMatch = (indLink.getAttribute('href') || '').match(/\/i(\d+)\//);
                if (codeMatch) industryCode = codeMatch[1];
            }

            // 克隆节点并在内联标签 (em/a/span) 前后插入空格，避免文本无缝粘连（如 "已上市10000人以上"）
            const cloneP = primaryP.cloneNode(true);
            cloneP.querySelectorAll('em, a, span').forEach(el => {
                el.insertAdjacentText('beforebegin', ' ');
                el.insertAdjacentText('afterend', ' ');
            });
            const rawText = cloneP.textContent || '';

            // 融资阶段精准匹配
            const stageMatch = rawText.match(/(未融资|天使轮|种子轮|A轮(?:\+)?|B轮(?:\+)?|C轮(?:\+)?|D轮(?:\+)?|D轮及以上|已上市|战略融资|战略投资|上市公司|不需要融资|不需要)/i);
            if (stageMatch) {
                stage = stageMatch[1];
            }

            // 规模精准匹配 (例: "10000人以上", "100-499人", "少于15人")
            const scaleMatch = rawText.match(/(\d+(?:-\d+)?人|\d+人以上|少于\d+人)/);
            if (scaleMatch) {
                scale = scaleMatch[1];
            }
        }

        // 4. 企业官方标签 / 荣誉资质
        const brandLabels = [];
        document.querySelectorAll('.brand-list a.brand-label').forEach(el => {
            const t = cleanStr(el.textContent);
            if (t && !brandLabels.includes(t)) brandLabels.push(t);
        });

        // 5. 在招职位数与在线BOSS数
        let activeJobsCount = 0;
        const jobStatEl = document.querySelector('.company-stat a[ka="all-jobs-top"] b');
        if (jobStatEl) {
            activeJobsCount = parseInt(jobStatEl.textContent.trim(), 10) || 0;
        } else {
            const tabEl = document.querySelector('.company-tab a[ka="company-jobs"]');
            if (tabEl) {
                const match = (tabEl.textContent || '').match(/\((\d+)\)/);
                if (match) activeJobsCount = parseInt(match[1], 10) || 0;
            }
        }

        let bossCount = 0;
        const bossStatEl = document.querySelector('.company-stat span:nth-child(2) b');
        if (bossStatEl) {
            bossCount = parseInt(bossStatEl.textContent.trim(), 10) || 0;
        }

        // 6. 公司简介
        let introduction = '';
        const introSec = document.querySelector('.company-info-box .job-sec:not(.company-photo):not(.company-talents):not(.company-products-new):not(.company-business)');
        const introTextEl = introSec ? introSec.querySelector('.text.fold-text, .text') : document.querySelector('.company-info-box .fold-text');
        if (introTextEl) {
            introduction = cleanMultiLineStr(introTextEl.innerText)
                .replace(/\s*展开\s*$/g, '')
                .replace(/\s*收起\s*$/g, '')
                .trim();
        }

        // 7. 工商信息 (Business Registration)
        const businessInfo = {};
        const bItems = document.querySelectorAll('.company-business .business-detail ul li');
        bItems.forEach(li => {
            const titleSpan = li.querySelector('span.t');
            if (titleSpan) {
                const key = cleanStr(titleSpan.textContent).replace(/[:：]/g, '');
                const val = cleanStr(li.textContent.replace(titleSpan.textContent, ''));
                if (key) businessInfo[key] = val;
            }
        });

        const companyFullName = businessInfo['企业名称'] || companyName;

        // 8. 公司地址与地图坐标 (支持多个职场)
        const locations = [];
        document.querySelectorAll('.job-location .location-item').forEach(item => {
            const addrEl = item.querySelector('.location-address');
            let addr = addrEl ? cleanStr(addrEl.textContent) : '';
            addr = addr.replace(/\s*(展开|收起)\s*/g, '').trim();

            const mapEl = item.querySelector('.map-container');
            const addressId = mapEl?.getAttribute('data-addressid') || '';
            const coordinate = mapEl?.getAttribute('data-lat') || '';
            let longitude = null;
            let latitude = null;
            if (coordinate && coordinate.includes(',')) {
                const [lng, lat] = coordinate.split(',').map(s => parseFloat(s.trim()));
                if (!isNaN(lng)) longitude = lng;
                if (!isNaN(lat)) latitude = lat;
            }

            const mapImg = mapEl?.querySelector('img')?.src || '';

            if (addr || coordinate) {
                locations.push({
                    address: addr,
                    addressId: addressId,
                    coordinate: coordinate,
                    longitude: longitude,
                    latitude: latitude,
                    mapImg: mapImg
                });
            }
        });

        // 9. 工作时间、作息与福利
        let workTime = '';
        let restSchedule = '';
        const workTimeSec = document.querySelector('.company-sider .work-time');
        if (workTimeSec) {
            const ps = workTimeSec.querySelectorAll('p span');
            if (ps[0]) workTime = cleanStr(ps[0].textContent);
            if (ps[1]) restSchedule = cleanStr(ps[1].textContent);
        }

        const welfareTags = [];
        document.querySelectorAll('.work-tags .work-tag-item').forEach(item => {
            const t = cleanStr(item.textContent);
            if (t && !welfareTags.includes(t)) welfareTags.push(t);
        });

        // 10. 人才发展
        const talentCultivation = [];
        document.querySelectorAll('.company-talents .company-talents-list li').forEach(item => {
            const t = cleanStr(item.textContent);
            if (t && !talentCultivation.includes(t)) talentCultivation.push(t);
        });

        // 11. 产品与服务介绍
        const products = [];
        document.querySelectorAll('.company-products-new ul li').forEach(li => {
            const pName = cleanStr(li.querySelector('.name a')?.textContent);
            const pLogo = li.querySelector('.figure img')?.src || '';
            const pSlogan = cleanStr(li.querySelector('.company-product-slogan')?.textContent);
            const pDescEl = li.querySelector('.company-product-intro');
            let pDesc = pDescEl ? cleanStr(pDescEl.textContent) : '';
            pDesc = pDesc.replace(/\s*(展开|收起)\s*/g, '').trim();

            if (pName || pDesc || pLogo) {
                products.push({
                    name: pName,
                    logo: pLogo,
                    slogan: pSlogan,
                    description: pDesc
                });
            }
        });

        // 12. 页面来源与更新时间
        const updateTimeText = cleanStr(document.querySelector('.update-time')?.textContent);
        const canonicalUrl = document.querySelector('link[rel="canonical"]')?.getAttribute('href') || location.href;

        // 组装最终全景数据对象（精简掉 mediaItems、recruiters、hotJobs 等冗余大字段）
        const companyPayload = {
            // 基础通用规范
            platform: 'boss',
            dataSource: 'boss_company_details',
            '平台': 'Boss直聘',
            '数据来源': 'boss_company_details',

            // 核心主键与名称
            companyId: companyId,
            '公司ID': companyId,
            companyName: companyName,
            '公司名称': companyName,
            companyFullName: companyFullName,
            '公司全称': companyFullName,
            logo: logo,

            // 资质与特征
            stage: stage,
            '融资阶段': stage,
            scale: scale,
            '公司规模': scale,
            industry: industry,
            '公司行业': industry,
            industryCode: industryCode,
            brandLabels: brandLabels,
            '企业标签': brandLabels.join(','),

            // 统计指标
            activeJobsCount: activeJobsCount,
            '在招职位数': activeJobsCount,
            bossCount: bossCount,
            '在线Boss数': bossCount,

            // 简介与作息福利
            introduction: introduction,
            '公司简介': introduction,
            workTime: workTime,
            '工作时间': workTime,
            restSchedule: restSchedule,
            '休息时间': restSchedule,
            welfare: welfareTags,
            '公司福利': welfareTags.join(','),

            // 人才与产品
            talentCultivation: talentCultivation,
            products: products,

            // 地址矩阵
            locations: locations,
            '详细完整地址': locations.length > 0 ? locations[0].address : (businessInfo['注册地址'] || ''),

            // 工商信息
            businessInfo: businessInfo,
            '法定代表人': businessInfo['法定代表人'] || '',
            '成立日期': businessInfo['成立时间'] || '',
            '企业类型': businessInfo['企业类型'] || '',
            '经营状态': businessInfo['经营状态'] || '',
            '注册资金': businessInfo['注册资本'] || '',
            '统一社会信用代码': businessInfo['统一社会信用代码'] || '',
            '注册地址': businessInfo['注册地址'] || '',
            '经营范围': businessInfo['经营范围'] || '',

            // 页面来源与时间
            updateTime: updateTimeText,
            url: canonicalUrl,
            scrapedAt: new Date().toLocaleString()
        };

        return companyPayload;
    }

    // ==========================================
    // 存储与同步模块
    // ==========================================

    function saveAndSyncCompany(companyData) {
        if (!companyData.companyId && !companyData.companyName && !companyData.companyFullName) {
            console.warn('[Boss Company Scraper] 未检测到有效的公司ID或名称，跳过保存');
            return;
        }

        console.log('🏢 [Boss Company Scraper] 提取到的企业全景数据:', companyData);

        // 1. 同步到 chrome.storage.local
        chrome.storage.local.get(['boss_companies_scraped', 'boss_company_details'], (res) => {
            // (a) 简要表 boss_companies_scraped (兼容已有的 options.js 企业卡片列表)
            const compList = res.boss_companies_scraped || [];
            const cId = companyData.companyId;
            const cName = companyData.companyFullName || companyData.companyName;

            const existingIdx = compList.findIndex(c => (cId && c['公司ID'] === cId) || (!cId && c['公司全称'] === cName));
            const summaryRow = {
                '公司ID': cId || '',
                '公司全称': cName || '',
                '公司名称': companyData.companyName || '',
                '法定代表人': companyData['法定代表人'] || '',
                '成立日期': companyData['成立日期'] || '',
                '企业类型': companyData['企业类型'] || '',
                '经营状态': companyData['经营状态'] || '',
                '注册资金': companyData['注册资金'] || '',
                '统一社会信用代码': companyData['统一社会信用代码'] || '',
                '公司行业': companyData.industry || '',
                '公司规模': companyData.scale || '',
                '融资阶段': companyData.stage || '',
                '公司福利': companyData['公司福利'] || '',
                '详细完整地址': companyData['详细完整地址'] || '',
                '在招职位数': companyData.activeJobsCount || 0,
                'sourcePlatform': 'Boss直聘',
                'platform': 'boss',
                'dataSource': 'boss_company_details',
                '更新时间': new Date().toLocaleString()
            };

            if (existingIdx >= 0) {
                compList[existingIdx] = { ...compList[existingIdx], ...summaryRow };
            } else {
                summaryRow['创建时间'] = summaryRow['更新时间'];
                compList.push(summaryRow);
            }

            // (b) 完整全景详情库 boss_company_details (按 companyId / cName 索引)
            const compDetails = res.boss_company_details || {};
            const detailKey = cId || cName;
            if (detailKey) {
                compDetails[detailKey] = companyData;
            }

            chrome.storage.local.set({
                boss_companies_scraped: compList,
                boss_company_details: compDetails
            }, () => {
                console.log('[Boss Company Scraper] 已成功存储至本地扩展存储');
            });
        });

        // 2. 同步推送到本地 API 服务 (SQLite/企业库)
        fetch('http://localhost:3000/api/companies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([companyData])
        })
        .then(res => res.json())
        .then(data => {
            console.log('🚀 [Boss Company Scraper] 本地服务器同步成功:', data);
            showToast(`🏢 已抓取企业 [${companyData.companyName || companyData.companyFullName}] 并同步到本地库`, true);
        })
        .catch(err => {
            console.log('[Boss Company Scraper] 本地服务器未启动 (正常现象，已保存至插件存储):', err);
            showToast(`🏢 已成功抓取企业 [${companyData.companyName || companyData.companyFullName}]`, true);
        });

        // 3. 发送扩展内部广播消息
        try {
            chrome.runtime.sendMessage({
                action: 'BOSS_COMPANY_EXTRACTED',
                data: companyData
            }).catch(() => {});
        } catch (e) {}
    }

    // ==========================================
    // 页面悬浮操作栏 (快捷手动抓取/状态指示)
    // ==========================================

    function injectFloatingButton() {
        if (document.getElementById('__boss_company_scrape_btn__')) return;

        const btn = document.createElement('div');
        btn.id = '__boss_company_scrape_btn__';
        btn.style.cssText = `
            position: fixed;
            bottom: 80px;
            right: 24px;
            z-index: 999999;
            background: linear-gradient(135deg, #00bebd 0%, #008f8e 100%);
            color: #ffffff;
            padding: 10px 18px;
            border-radius: 24px;
            cursor: pointer;
            box-shadow: 0 4px 14px rgba(0, 190, 189, 0.4);
            font-size: 13px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.25s ease;
            user-select: none;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
        `;
        btn.innerHTML = `<span>🏢</span><span>抓取公司全景数据</span>`;

        btn.onmouseenter = () => {
            btn.style.transform = 'scale(1.05)';
            btn.style.boxShadow = '0 6px 18px rgba(0, 190, 189, 0.55)';
        };
        btn.onmouseleave = () => {
            btn.style.transform = 'scale(1)';
            btn.style.boxShadow = '0 4px 14px rgba(0, 190, 189, 0.4)';
        };

        btn.onclick = () => {
            btn.style.opacity = '0.7';
            btn.innerHTML = `<span>⏳</span><span>正在抓取...</span>`;
            setTimeout(() => {
                try {
                    const data = extractCompanyData();
                    saveAndSyncCompany(data);
                    btn.innerHTML = `<span>✅</span><span>抓取成功</span>`;
                    setTimeout(() => {
                        btn.style.opacity = '1';
                        btn.innerHTML = `<span>🏢</span><span>更新公司全景数据</span>`;
                    }, 2000);
                } catch (e) {
                    console.error('[Boss Company Scraper] 手动提取失败:', e);
                    showToast('❌ 提取失败: ' + e.message, false);
                    btn.style.opacity = '1';
                    btn.innerHTML = `<span>❌</span><span>提取失败，重试</span>`;
                }
            }, 300);
        };

        document.body.appendChild(btn);
    }

    // ==========================================
    // 自动轮询与执行入口
    // ==========================================

    let isExtracting = false;
    let lastUrl = '';

    function triggerAutoExtraction() {
        if (!isCompanyPage()) return;
        if (location.href === lastUrl && !isExtracting) return;

        const currentUrl = location.href;
        isExtracting = true;
        let retries = 0;
        const maxRetries = 25;

        console.log('[Boss Company Scraper] 检测到进入公司详情页，启动抓取流程:', currentUrl);

        const timer = setInterval(() => {
            retries++;
            // 关键元素就绪判断
            const hasHeader = document.querySelector('.info-primary .info .name') || document.querySelector('.smallbanner .name');
            const hasBusiness = document.querySelector('.company-business .business-detail');
            const hasIntro = document.querySelector('.company-info-box');

            if (hasHeader || hasBusiness || hasIntro || retries >= 6) {
                clearInterval(timer);
                lastUrl = currentUrl;

                // 稍微延迟 400ms 确保 swiper 相册和地图经纬度挂载完毕
                setTimeout(() => {
                    try {
                        const data = extractCompanyData();
                        saveAndSyncCompany(data);
                        injectFloatingButton();
                    } catch (e) {
                        console.error('[Boss Company Scraper] 自动提取报错:', e);
                    } finally {
                        isExtracting = false;
                    }
                }, 400);
            } else if (retries >= maxRetries) {
                clearInterval(timer);
                isExtracting = false;
                console.warn('[Boss Company Scraper] 等待页面 DOM 元素超时');
            }
        }, 500);
    }

    // 1. 页面加载完成执行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', triggerAutoExtraction);
    } else {
        triggerAutoExtraction();
    }

    // 2. 监听单页路由与 URL 变动
    let currHref = location.href;
    setInterval(() => {
        if (location.href !== currHref) {
            currHref = location.href;
            if (isCompanyPage()) {
                triggerAutoExtraction();
            }
        }
    }, 1000);

    window.addEventListener('popstate', () => {
        if (isCompanyPage()) triggerAutoExtraction();
    });

    // 3. 监听来自 popup 的手动抓取消息
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'boss_scrape_company') {
                try {
                    const data = extractCompanyData();
                    saveAndSyncCompany(data);
                    sendResponse({ success: true, data: data });
                } catch (e) {
                    sendResponse({ success: false, error: e.message });
                }
            }
        });
    }

})();
