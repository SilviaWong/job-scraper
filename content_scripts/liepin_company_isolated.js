(function () {
    'use strict';

    // ==========================================
    // LIEPIN COMPANY DETAIL ISOLATED SCRIPT
    // 专门提取猎聘公司主页 / 公司职位页的企业全景数据
    // ==========================================

    console.log("🏢 [Liepin Company Scraper] 脚本已加载，准备提取公司信息:", location.href);

    // 解码 Unicode 转义序列 (如 \\u5E93\\u5361) 及 URL 百分号编码
    function decodeUnicode(str) {
        if (!str) return '';
        let res = String(str);
        // 解码 \uXXXX 或 \\uXXXX 形式的 Unicode 转义字符
        if (res.includes('\\u') || res.includes('\\U')) {
            try {
                res = res.replace(/\\u([0-9a-fA-F]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
            } catch (e) {
                try {
                    res = JSON.parse(`"${res.replace(/"/g, '\\"')}"`);
                } catch (err) {}
            }
        }
        // 解码 URL 百分号编码 %E5%BA%93
        if (res.includes('%')) {
            try {
                res = decodeURIComponent(res);
            } catch (e) {}
        }
        return res;
    }

    // 工具函数：清理文本（自动转码与去除空白）
    function cleanStr(str) {
        if (!str) return '';
        return decodeUnicode(String(str))
            .replace(/[\r\n\t]+/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    // 显示轻量右上角提示 Toast
    function showToast(message, isSuccess = true) {
        try {
            const toastId = '__liepin_company_scraper_toast__';
            let toast = document.getElementById(toastId);
            if (!toast) {
                toast = document.createElement('div');
                toast.id = toastId;
                toast.style.cssText = `
                    position: fixed;
                    bottom: 24px;
                    right: 24px;
                    z-index: 999999;
                    padding: 10px 18px;
                    border-radius: 8px;
                    font-size: 13px;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    transition: all 0.3s ease;
                    pointer-events: none;
                `;
                document.body.appendChild(toast);
            }
            toast.style.backgroundColor = isSuccess ? '#07c160' : '#fa5151';
            toast.style.color = '#ffffff';
            toast.innerText = message;
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';

            setTimeout(() => {
                if (toast) {
                    toast.style.opacity = '0';
                    toast.style.transform = 'translateY(10px)';
                }
            }, 4000);
        } catch (e) {
            console.log('[Liepin Company Scraper] Toast error:', e);
        }
    }

    // 从页面内嵌的 script 标签中尝试获取 $CONFIG 辅助数据
    function extractInlineConfig() {
        const result = {};
        try {
            const scripts = document.querySelectorAll('script:not([src])');
            for (let s of scripts) {
                const text = s.innerHTML || '';
                if (text.includes('$CONFIG') || text.includes('compFullName') || text.includes('compId')) {
                    // 提取 compId
                    const compIdMatch = text.match(/["']?compId["']?\s*:\s*["']?(\d+)["']?/);
                    if (compIdMatch) result.compId = compIdMatch[1];

                    // 提取 compFullName（自动进行 Unicode 解码）
                    const compFullNameMatch = text.match(/["']?compFullName["']?\s*:\s*["']([^"'\n\r]+)["']/);
                    if (compFullNameMatch) {
                        result.compFullName = cleanStr(compFullNameMatch[1]);
                    }

                    // 提取 address
                    const addressMatch = text.match(/["']?address["']?\s*:\s*["']([^"'\n\r]+)["']/);
                    if (addressMatch) {
                        result.address = cleanStr(addressMatch[1]);
                    }

                    // 提取 point 经纬度
                    const pointMatch = text.match(/["']?point["']?\s*:\s*["']([^"'\n\r]+)["']/);
                    if (pointMatch) {
                        try {
                            const rawPoint = cleanStr(pointMatch[1]);
                            result.point = JSON.parse(rawPoint);
                        } catch (e) {
                            result.point = pointMatch[1];
                        }
                    }
                }
            }
        } catch (e) {
            console.log('[Liepin Company Scraper] extractInlineConfig error:', e);
        }
        return result;
    }

    // 核心提取函数
    function extractCompanyData() {
        const inlineConfig = extractInlineConfig();

        // 1. 公司ID
        const urlMatch = location.href.match(/\/company(?:-jobs)?\/(\d+)/);
        const compId = urlMatch ? urlMatch[1] : (inlineConfig.compId || '');

        // 2. 公司简称
        const compNameNode = document.querySelector('[data-selector="company-name"]') ||
                             document.querySelector('.company-header-content-name .title') ||
                             document.querySelector('.company-logo-64');
        let compName = compNameNode ? cleanStr(compNameNode.innerText || compNameNode.getAttribute('alt')) : '';

        // 3. 公司Logo
        const logoNode = document.querySelector('.company-header-content-name img.logo') ||
                         document.querySelector('img.company-logo-64');
        let logo = logoNode ? logoNode.src : '';
        if (logo && logo.startsWith('//')) logo = 'https:' + logo;

        // 4. 基本属性：行业、规模、融资阶段
        let industry = '';
        let scale = '';
        let stage = '';
        const basicPropsNode = document.querySelector('.company-header-content-name .name-right p');
        if (basicPropsNode) {
            const rawParts = (basicPropsNode.innerText || '')
                .split(/·|\n/)
                .map(s => cleanStr(s))
                .filter(Boolean);

            const remainingIndustries = [];
            for (const part of rawParts) {
                if (/(\d+(?:-\d+)?人|\d+人以上|少于\d+人)/.test(part)) {
                    scale = part;
                } else if (/^(未融资|天使轮|种子轮|A轮|A\+轮|B轮|B\+轮|C轮|C\+轮|D轮|D\+轮|D轮及以上|已上市|战略融资|战略投资|上市公司|不需要融资|不需要)$/i.test(part)) {
                    stage = part;
                } else {
                    remainingIndustries.push(part);
                }
            }
            if (remainingIndustries.length > 0) {
                industry = remainingIndustries.join('·');
            }
        }

        // 5. 工作时间与制度
        let workTime = '';
        let workTimeType = '';
        const timeNode = document.querySelector('.work-time .time');
        if (timeNode) workTime = cleanStr(timeNode.innerText);
        const timeTypeNode = document.querySelector('.work-time .time-type');
        if (timeTypeNode) workTimeType = cleanStr(timeTypeNode.innerText);

        // 6. 企业福利与标签
        const tagList = [];
        const tagSpans = document.querySelectorAll('[data-selector="company-tags-box"] .tags-item span, [data-selector="company-tags-box"] .tags-item-text span');
        tagSpans.forEach(span => {
            const t = cleanStr(span.innerText);
            if (t && !tagList.includes(t)) {
                tagList.push(t);
            }
        });

        // 7. 企业介绍 (Company Introduction)
        let companyDesc = '';
        const introTextNode = document.querySelector('[data-selector="company-introduction-text"] .inner-text') ||
                              document.querySelector('[data-selector="company-introduction-text"]') ||
                              document.querySelector('.company-introduction-text');
        if (introTextNode) {
            companyDesc = (introTextNode.innerText || '')
                .replace(/\.\.\.\s*查看全部/g, '')
                .replace(/收起$/g, '')
                .trim();
        }

        // 8. 产品与服务 (Product List)
        const products = [];
        const productItems = document.querySelectorAll('#company-product-root .list-item');
        productItems.forEach(item => {
            const pLogoNode = item.querySelector('img');
            let pLogo = pLogoNode ? pLogoNode.src : '';
            if (pLogo && pLogo.startsWith('//')) pLogo = 'https:' + pLogo;
            const pDescNode = item.querySelector('.desc');
            const pDesc = pDescNode ? (pDescNode.innerText || '').trim() : '';
            if (pDesc || pLogo) {
                products.push({ logo: pLogo, desc: pDesc });
            }
        });

        // 9. 工商信息 (Business Registration)
        const businessInfo = {};
        const regItems = document.querySelectorAll('.business-register-comp .business-register-content-item');
        regItems.forEach(item => {
            const nameEl = item.querySelector('.name');
            const textEl = item.querySelector('.text');
            if (nameEl && textEl) {
                const label = cleanStr(nameEl.innerText);
                const val = cleanStr(textEl.innerText);
                if (label) {
                    businessInfo[label] = val;
                }
            }
        });

        // 公司全称：优先从工商信息“企业全称”获取，其次内联配置，最后回退简称
        let compFullName = businessInfo['企业全称'] || inlineConfig.compFullName || compName;
        if (!compName && compFullName) compName = compFullName;

        // 10. 融资历史 (Financing Timeline)
        const financingList = [];
        const financingSteps = document.querySelectorAll('.financing-info-comp .financing-step');
        financingSteps.forEach(step => {
            const month = cleanStr(step.querySelector('.date-box .month')?.innerText);
            const year = cleanStr(step.querySelector('.date-box .year')?.innerText);
            const textBox = cleanStr(step.querySelector('.text-box')?.innerText);
            const agencyBox = cleanStr(step.querySelector('.agency-box')?.innerText?.replace(/投资机构：/g, ''));
            const dateStr = (year && month) ? `${year}-${month}` : (year || '');

            if (textBox || dateStr || agencyBox) {
                financingList.push({
                    date: dateStr,
                    roundInfo: textBox,
                    investors: agencyBox
                });
            }
        });

        // 11. 企业相册与风采图片 (Media Images)
        const mediaImages = [];
        const mediaNodes = document.querySelectorAll('#company-introduction-media .swiper-slide a.img, #company-introduction-media .swiper-slide .img');
        mediaNodes.forEach(node => {
            let bg = node.style.backgroundImage || '';
            const match = bg.match(/url\(['"]?([^'"]+)['"]?\)/);
            if (match && match[1]) {
                let imgUrl = match[1];
                if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
                if (!mediaImages.includes(imgUrl)) {
                    mediaImages.push(imgUrl);
                }
            }
        });

        // 12. 在招职位数
        let activeJobsCount = 0;
        const jobTabNode = document.querySelector('.company-header-content-tab a[href*="company-jobs"]');
        if (jobTabNode) {
            const jobMatch = (jobTabNode.innerText || '').match(/\((\d+)\)/);
            if (jobMatch) activeJobsCount = parseInt(jobMatch[1], 10);
        }

        // 13. 公司地址
        let address = businessInfo['注册地址'] || businessInfo['所在地'] || inlineConfig.address || '';

        // 14. 页面结构化数据 (JSON-LD)
        let ldData = null;
        try {
            const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (let s of ldScripts) {
                const parsed = JSON.parse(s.innerHTML.replace(/[\r\n\t]+/g, ' '));
                if (parsed['@context'] && parsed['@context'].includes('cambrian.jsonld')) {
                    ldData = parsed;
                    break;
                }
            }
        } catch (e) { }

        // 组装最终的公司数据结构体
        const companyPayload = {
            platform: 'liepin',
            dataSource: 'liepin_company_details',
            '平台': 'liepin',
            '数据来源': 'liepin_company_details',
            compId: compId,
            companyId: compId,
            compName: compName,
            companyName: compName,
            compFullName: compFullName,
            companyFullName: compFullName,
            logo: logo,
            industry: industry,
            scale: scale,
            stage: stage,
            workTime: workTime,
            workTimeType: workTimeType,
            welfare: tagList,
            tags: tagList,
            companyDesc: companyDesc,
            introduction: companyDesc,
            products: products,
            businessInfo: businessInfo,
            financingList: financingList,
            mediaImages: mediaImages,
            activeJobsCount: activeJobsCount,
            address: address,
            locationPoint: inlineConfig.point || null,
            cambrianLd: ldData,
            url: location.href,
            scrapedAt: new Date().toISOString()
        };

        return companyPayload;
    }

    // 存储与同步
    function saveAndSyncCompany(companyData) {
        if (!companyData.compName && !companyData.compId && !companyData.compFullName) {
            console.warn('[Liepin Company Scraper] 未能提取到有效的公司名称或ID，跳过保存');
            return;
        }

        console.log('✅ [Liepin Company Scraper] 成功提取公司详情:', companyData);

        // 1. 存入 chrome.storage.local (单独保存在 liepin_company_details 详情库中)
        chrome.storage.local.get(['liepin_company_details'], (res) => {
            const compDetails = res.liepin_company_details || {};
            const targetKey = String(companyData.compId || companyData.compName || companyData.compFullName || '');

            if (targetKey) {
                compDetails[targetKey] = companyData;
            }

            chrome.storage.local.set({
                liepin_company_details: compDetails
            }, () => {
                console.log('[Liepin Company Scraper] 已单独保存到 chrome.storage.local (liepin_company_details)');
            });
        });

        // 2. 同步到本地接口
        fetch('http://localhost:3000/api/companies', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify([companyData])
        })
        .then(res => res.json())
        .then(data => {
            console.log('🚀 [Liepin Company Scraper] 本地数据库同步结果:', data);
            showToast(`🏢 已同步企业 [${companyData.compName || companyData.compFullName}] 到本地企业全景库`, true);
        })
        .catch(err => {
            console.log('[Liepin Company Scraper] 本地服务器未启动或同步失败 (属于正常情况):', err);
            showToast(`🏢 已提取企业 [${companyData.compName || companyData.compFullName}] (本地服务未连接)`, false);
        });

        // 3. 远端同步 (已注释)
        // fetch('https://job-dashboard-bgr.pages.dev/api/companies', {
        //     method: 'POST',
        //     headers: {
        //         'Content-Type': 'application/json'
        //     },
        //     body: JSON.stringify([companyData])
        // })
        // .then(res => res.json())
        // .then(data => {
        //     console.log('🌐 [Liepin Company Scraper] 远端数据库同步结果:', data);
        // })
        // .catch(() => {});

        // 4. 发送扩展内部消息
        try {
            chrome.runtime.sendMessage({
                action: 'LIEPIN_COMPANY_EXTRACTED',
                data: companyData
            }).catch(() => {});
        } catch (e) {}
    }

    // ==========================================
    // 自动触发执行引擎
    // 只要进入到猎聘公司详情页，自动检测并抓取
    // ==========================================
    let lastProcessedUrl = '';
    let isExtracting = false;

    function isCompanyPage() {
        return /\/company(?:-jobs)?\/\d+/.test(location.href);
    }

    function triggerAutoExtraction() {
        if (!isCompanyPage()) return;
        if (lastProcessedUrl === location.href && !isExtracting) return;

        const currentUrl = location.href;
        isExtracting = true;
        let retries = 0;
        const maxRetries = 30; // 最多等待 15 秒

        console.log("🚀 [Liepin Company Scraper] 检测到进入公司详情页，启动自动抓取流程:", currentUrl);

        const pollTimer = setInterval(() => {
            retries++;
            const hasHeader = document.querySelector('.company-header') ||
                              document.querySelector('[data-selector="company-name"]') ||
                              document.querySelector('.company-header-content-name');
            const hasIntro = document.querySelector('.company-introduction') ||
                             document.querySelector('.business-register-comp') ||
                             document.querySelector('#company-product-root');

            // 当关键 DOM 节点就绪，或者重试达到 8 次（4秒后页面基本稳定）
            if (hasHeader || hasIntro || retries >= 8) {
                clearInterval(pollTimer);
                lastProcessedUrl = currentUrl;

                // 延迟 300ms 确保异步组件（如产品服务、工商信息、轮播图）完全挂载
                setTimeout(() => {
                    try {
                        const companyData = extractCompanyData();
                        saveAndSyncCompany(companyData);
                    } catch (err) {
                        console.error('[Liepin Company Scraper] 提取异常:', err);
                    } finally {
                        isExtracting = false;
                    }
                }, 300);
            } else if (retries >= maxRetries) {
                clearInterval(pollTimer);
                isExtracting = false;
                console.warn('[Liepin Company Scraper] 等待 DOM 元素超时');
            }
        }, 500);
    }

    // 1. 首次进入页面立即触发
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', triggerAutoExtraction);
    } else {
        triggerAutoExtraction();
    }

    // 2. 监听单页应用 (SPA) 路由切换与 URL 变化
    let currentHref = location.href;
    setInterval(() => {
        if (location.href !== currentHref) {
            currentHref = location.href;
            if (isCompanyPage()) {
                console.log("🔄 [Liepin Company Scraper] 检测到 URL 路由切换，重新触发自动提取:", currentHref);
                triggerAutoExtraction();
            }
        }
    }, 1000);

    window.addEventListener('popstate', () => {
        if (isCompanyPage()) triggerAutoExtraction();
    });

})();
