document.addEventListener('DOMContentLoaded', () => {
    const btnOpenDashboard = document.getElementById('btn-open-dashboard');
    const unifiedTitle = document.getElementById('unified-title');
    const unifiedStatus = document.getElementById('unified-status');
    const unifiedCount = document.getElementById('unified-count');
    const btnStartUnified = document.getElementById('btn-start-unified');
    const btnStopUnified = document.getElementById('btn-stop-unified');
    const checkAutoScroll = document.getElementById('unified-auto-scroll');

    let currentPlatform = null; // 'boss', '51job', 'liepin', 'zhilian'
    let currentTabId = null;

    if (btnOpenDashboard) {
        btnOpenDashboard.addEventListener('click', () => {
            chrome.runtime.openOptionsPage();
        })
    }

    const platformConfig = {
        boss: {
            name: 'Boss 直聘',
            storageKey: 'boss_scraped_v2',
            startAction: 'boss_start',
            stopAction: 'boss_stop',
            statusAction: 'boss_get_status',
            singleAction: 'boss_scrape_single',
            urlMatch: 'zhipin.com'
        },
        '51job': {
            name: '51job 前程无忧',
            storageKey: '51job_scraped_v2',
            startAction: '51job_start',
            stopAction: '51job_stop',
            statusAction: '51job_get_status',
            singleAction: '51job_scrape_single',
            urlMatch: '51job.com'
        },
        liepin: {
            name: '猎聘网 Liepin',
            storageKey: 'liepin_scraped_data_v1',
            startAction: 'liepin_start',
            stopAction: 'liepin_stop',
            statusAction: 'liepin_get_status',
            singleAction: 'liepin_scrape_single',
            urlMatch: 'liepin.com'
        },
        zhilian: {
            name: '智联招聘 Zhaopin',
            storageKey: 'zhilian_scraped_v2',
            startAction: 'zhilian_start',
            stopAction: 'zhilian_stop',
            statusAction: 'zhilian_get_status',
            singleAction: 'zhilian_scrape_single',
            urlMatch: 'zhaopin.com'
        }
    };

    function disableUI() {
        if (!unifiedTitle) return;
        unifiedTitle.textContent = "未检测到招聘网站";
        unifiedStatus.textContent = "请打开 Boss/51job/猎聘/智联 的职位列表页";
        unifiedStatus.className = "status idle";
        btnStartUnified.disabled = true;
        btnStopUnified.disabled = true;
    }

    let isDetailPage = false;
    let isCompanyPage = false;

    function detectPlatform() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]) {
                disableUI();
                return;
            }
            const url = tabs[0].url || '';
            currentTabId = tabs[0].id;
            
            for (const [key, config] of Object.entries(platformConfig)) {
                if (url.includes(config.urlMatch)) {
                    currentPlatform = key;
                    isDetailPage = (key === 'boss' && url.includes('/job_detail/')) ||
                                   (key === '51job' && url.includes('jobs.51job.com')) ||
                                   (key === 'liepin' && (url.includes('/job/') || url.includes('/a/'))) ||
                                   (key === 'zhilian' && url.includes('jobs.zhaopin.com'));

                    isCompanyPage = (key === 'boss' && url.includes('/gongsi/')) ||
                                    (key === 'liepin' && url.includes('/company/'));

                    let pageTypeDesc = '';
                    if (isDetailPage) pageTypeDesc = ' (职位详情页)';
                    else if (isCompanyPage) pageTypeDesc = ' (公司主页)';

                    unifiedTitle.textContent = `当前平台: ${config.name}${pageTypeDesc}`;
                    btnStartUnified.disabled = false;
                    btnStopUnified.disabled = false;
                    initPlatform(key, url);
                    return;
                }
            }
            disableUI();
        });
    }

    function initPlatform(platform, url) {
        const config = platformConfig[platform];
        
        const openModeContainer = document.getElementById('open-mode-container');
        const openModeLabel = document.getElementById('open-mode-label');
        const openModeSelect = document.getElementById('unified-open-mode');
        const settingsSection = document.querySelector('.settings');

        const chatScanSection = document.getElementById('chat-scan-section');
        const btnScanChatBlacklist = document.getElementById('btn-scan-chat-blacklist');

        if (isCompanyPage) {
            btnStartUnified.textContent = '🏢 抓取当前公司详情';
            btnStopUnified.style.display = 'none';
            if (settingsSection) settingsSection.style.display = 'none';
            unifiedStatus.textContent = '状态: 公司主页就绪 (已启用自动抓取)';
        } else if (isDetailPage) {
            btnStartUnified.textContent = '📥 抓取当前职位详情';
            btnStopUnified.style.display = 'none';
            if (settingsSection) settingsSection.style.display = 'none';
            unifiedStatus.textContent = '状态: 详情页就绪 (已启用自动抓取)';
        } else {
            btnStartUnified.textContent = '▶ 列表抓取';
            btnStopUnified.style.display = '';
            if (settingsSection) settingsSection.style.display = '';
        }

        if (url.includes('/web/geek/chat')) {
            if (chatScanSection) chatScanSection.style.display = 'block';
            if (btnScanChatBlacklist) {
                btnScanChatBlacklist.onclick = () => {
                    chrome.tabs.sendMessage(currentTabId, { action: 'boss_scan_chat_blacklist' }).catch(() => {});
                    window.close(); // 关闭 popup 方便查看页面上弹出的黑名单抽屉
                };
            }
        } else {
            if (chatScanSection) chatScanSection.style.display = 'none';
        }

        if (!isDetailPage) {
            if (platform === 'liepin') {
                if (openModeContainer) openModeContainer.style.display = 'block';
                if (openModeLabel) openModeLabel.textContent = '猎聘详情打开方式：';
                if (openModeSelect) {
                    openModeSelect.value = 'iframe';
                    openModeSelect.disabled = true;
                    openModeSelect.title = '猎聘网由于后台页面懒加载限制，已强制使用 iframe 模式';
                }
            } else if (platform === '51job') {
                if (openModeContainer) openModeContainer.style.display = 'block';
                if (openModeLabel) openModeLabel.textContent = '51job 详情打开方式：';
                if (openModeSelect) {
                    openModeSelect.disabled = false;
                    openModeSelect.title = '';
                }
            } else {
                if (openModeContainer) openModeContainer.style.display = 'none';
            }
        } else {
            if (openModeContainer) openModeContainer.style.display = 'none';
        }

        // Load count
        chrome.storage.local.get([config.storageKey], (res) => {
            if (chrome.runtime.lastError) return;
            const data = (res && res[config.storageKey]) || [];
            unifiedCount.textContent = data.length;
        });

        // Load status
        if (!isDetailPage) {
            chrome.tabs.sendMessage(currentTabId, { action: config.statusAction }, (response) => {
                if (chrome.runtime.lastError) return;
                if (response) {
                    btnStartUnified.disabled = response.isRunning;
                    unifiedStatus.textContent = `状态: ${response.status}`;
                    unifiedStatus.className = `status ${response.isRunning ? 'running' : 'idle'}`;
                }
            });
        }
    }

    detectPlatform();

    // Listeners for updates from content scripts
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (!currentPlatform) return;

        const updateUI = (status, isRunning, count) => {
            if (status !== undefined) {
                unifiedStatus.textContent = '状态: ' + status;
                unifiedStatus.className = isRunning ? 'status running' : 'status idle';
                btnStartUnified.disabled = isRunning;
            }
            if (count !== undefined) {
                unifiedCount.textContent = count;
            }
        };

        if (currentPlatform === 'boss') {
            if (request.action === 'boss_update_status') updateUI(request.status, request.isRunning);
            if (request.action === 'boss_update_count') updateUI(undefined, undefined, request.count);
        } else if (currentPlatform === '51job') {
            if (request.action === '51job_update_status') updateUI(request.status, request.isRunning);
            if (request.action === '51job_update_count') updateUI(undefined, undefined, request.count);
        } else if (currentPlatform === 'liepin') {
            if (request.action === 'liepin_update_status') updateUI(request.status, request.isRunning);
            if (request.action === 'liepin_update_count') updateUI(undefined, undefined, request.count);
        } else if (currentPlatform === 'zhilian') {
            if (request.action === 'zhilian_status_update') {
                const isIdle = request.statusText.includes('闲置') || request.statusText.includes('停止') || request.statusText.includes('暂停');
                updateUI(request.statusText, !isIdle, request.count);
            }
        }
    });

    if(btnStartUnified) {
        btnStartUnified.addEventListener('click', () => {
            if (!currentPlatform || !currentTabId) return;
            
            if (isCompanyPage) {
                const compAction = currentPlatform === 'boss' ? 'boss_scrape_company' : 'liepin_company_scrape';
                unifiedStatus.textContent = '状态: 正在抓取公司详情...';
                unifiedStatus.className = 'status running';
                chrome.tabs.sendMessage(currentTabId, { action: compAction }, (res) => {
                    setTimeout(() => {
                        unifiedStatus.textContent = '状态: 公司抓取完成';
                        unifiedStatus.className = 'status idle';
                    }, 800);
                }).catch(() => {
                    alert('无法连接到网页插件，请先刷新网页 (F5) 后再试！');
                    unifiedStatus.textContent = '状态: 未连接';
                    unifiedStatus.className = 'status idle';
                });
                return;
            }

            if (isDetailPage) {
                const singleAction = platformConfig[currentPlatform].singleAction;
                unifiedStatus.textContent = '状态: 正在抓取当前职位...';
                unifiedStatus.className = 'status running';
                chrome.tabs.sendMessage(currentTabId, { action: singleAction }, (res) => {
                    setTimeout(() => {
                        unifiedStatus.textContent = '状态: 抓取完成';
                        unifiedStatus.className = 'status idle';
                    }, 800);
                }).catch(() => {
                    alert('无法连接到网页插件，请先刷新网页 (F5) 后再试！');
                    unifiedStatus.textContent = '状态: 未连接';
                    unifiedStatus.className = 'status idle';
                });
                return;
            }

            let targetAction = platformConfig[currentPlatform].startAction;
            executeStart(targetAction);
        });
    }

    function executeStart(targetAction) {
        const openModeSelect = document.getElementById('unified-open-mode');
        const openMode = openModeSelect ? openModeSelect.value : 'iframe';
        const skipScrapedCheck = document.getElementById('unified-skip-scraped');
        
        chrome.tabs.sendMessage(currentTabId, {
            action: targetAction,
            autoScroll: checkAutoScroll ? checkAutoScroll.checked : true,
            openMode: openMode,
            skipScraped: skipScrapedCheck ? skipScrapedCheck.checked : true
        }).catch(() => {
            alert('无法连接到网页插件，请先刷新网页 (F5) 后再试！');
            btnStartUnified.disabled = false;
            unifiedStatus.textContent = '状态: 未连接';
            unifiedStatus.className = 'status idle';
        });
        btnStartUnified.disabled = true;
        unifiedStatus.textContent = '状态: 正在初始化...';
        unifiedStatus.className = 'status running';
    }

    if(btnStopUnified) {
        btnStopUnified.addEventListener('click', () => {
            if (!currentPlatform || !currentTabId) return;
            
            let targetAction = platformConfig[currentPlatform].stopAction;
            executeStop(targetAction);
        });
    }

    function executeStop(targetAction) {
        chrome.tabs.sendMessage(currentTabId, { action: targetAction }).catch(() => {});
        btnStartUnified.disabled = false;
        unifiedStatus.textContent = '状态: 已暂停';
        unifiedStatus.className = 'status idle';
    }
});
