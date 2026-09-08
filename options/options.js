// 全局防御：拦截并自动消费 chrome.runtime.lastError，防止 LevelDB 底层 IO 错误抛出未捕获异常
(function wrapChromeStorage() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

    const originalGet = chrome.storage.local.get.bind(chrome.storage.local);
    const originalSet = chrome.storage.local.set.bind(chrome.storage.local);
    const originalRemove = chrome.storage.local.remove.bind(chrome.storage.local);
    const originalClear = chrome.storage.local.clear ? chrome.storage.local.clear.bind(chrome.storage.local) : null;

    function handleStorageError(actionType, err) {
        if (!err) return;
        console.warn(`[Chrome Storage IO Warning] 本地数据库${actionType}受阻:`, err.message);
        if (err.message && (err.message.includes('Unable to create writable file') || err.message.includes('IO error'))) {
            if (typeof showStatus === 'function') {
                const tip = '⚠️ 本地数据库被 Chrome 底层锁定(LevelDB 句柄冲突)。点击此处【一键重启扩展】立即恢复！';
                const toast = showStatus(tip, 'error');
                if (toast) {
                    toast.style.cursor = 'pointer';
                    toast.title = '点击立即重载扩展程序并重置存储连接';
                    toast.onclick = () => {
                        if (chrome.runtime && typeof chrome.runtime.reload === 'function') {
                            chrome.runtime.reload();
                        } else {
                            location.reload();
                        }
                    };
                }
            }
        }
    }

    chrome.storage.local.get = function(keys, callback) {
        return originalGet(keys, (result) => {
            const err = chrome.runtime.lastError;
            handleStorageError('读取', err);
            if (typeof callback === 'function') {
                callback(err ? {} : (result || {}));
            }
        });
    };

    chrome.storage.local.set = function(items, callback) {
        return originalSet(items, () => {
            const err = chrome.runtime.lastError;
            handleStorageError('写入', err);
            if (typeof callback === 'function') {
                callback(err);
            }
        });
    };

    chrome.storage.local.remove = function(keys, callback) {
        return originalRemove(keys, () => {
            const err = chrome.runtime.lastError;
            handleStorageError('清理', err);
            if (typeof callback === 'function') {
                callback(err);
            }
        });
    };

    if (originalClear) {
        chrome.storage.local.clear = function(callback) {
            return originalClear(() => {
                const err = chrome.runtime.lastError;
                handleStorageError('全量清空', err);
                if (typeof callback === 'function') {
                    callback(err);
                }
            });
        };
    }
})();

function showStatus(message, type = 'success') {
    let container = document.getElementById('status-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'status-toast-container';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            align-items: flex-end;
            z-index: 10000;
        `;
        document.body.appendChild(container);
    }

    const status = document.createElement('div');
    status.className = `status-toast ${type}`;
    status.textContent = message;

    let backgroundColor = '#10b981'; // 默认success
    if (type === 'error') {
        backgroundColor = '#ef4444';
    } else if (type === 'warning') {
        backgroundColor = '#f59e0b';
    } else if (type === 'loading') {
        backgroundColor = '#3b82f6';
    }

    status.style.cssText = `
        position: relative;
        padding: 12px 20px;
        border-radius: 6px;
        color: white;
        font-size: 14px;
        animation: slideInToast 0.3s ease;
        background: ${backgroundColor};
        max-width: 400px;
        word-wrap: break-word;
        box-shadow: 0 4px 10px rgba(0,0,0,0.12);
    `;

    // 如果还没有动画样式，就加上
    if (!document.getElementById('toast-animation-style')) {
        const style = document.createElement('style');
        style.id = 'toast-animation-style';
        style.textContent = `
            @keyframes slideInToast {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }

    if (type === 'loading') {
        const spinner = document.createElement('span');
        spinner.style.cssText = `
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid rgba(255,255,255,0.3);
            border-top: 2px solid white;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-right: 8px;
            vertical-align: middle;
        `;
        status.insertBefore(spinner, status.firstChild);
    }

    container.appendChild(status);

    if (type === 'loading') {
        status._isLoading = true;
    } else {
        setTimeout(() => {
            if (status.parentElement === container) {
                container.removeChild(status);
            }
            if (container.childElementCount === 0 && document.body.contains(container)) {
                document.body.removeChild(container);
            }
        }, 3000);
    }
    return status;
}

document.addEventListener('DOMContentLoaded', () => {
    let allData = [];
    let currentSource = 'boss-data'; // 'boss-data' or '51job-data'

    let blacklistedCompanies = [];
    let favoritedJobs = [];
    let jobStatuses = {}; // jobId -> status
    let jobInterviews = {}; // jobId -> { time, type, round, note }
    let aiScores = {}; // jobId -> { score, matchLevel, resultText }
    let aiIntros = {}; // jobId -> introText
    let currentDisplayedJobs = [];
    let questionBank = []; // array of { id, title, tags, answer, createdAt, updatedAt }
    let aiSettings = {
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: '默认配置', url: '', key: '', model: '' }],
        resume: ''
    };

    function getActiveAiProfile() {
        if (!aiSettings.profiles || aiSettings.profiles.length === 0) return { url: '', key: '', model: '' };
        const active = aiSettings.profiles.find(p => p.id === aiSettings.activeProfileId);
        return active || aiSettings.profiles[0];
    }

    const cardGrid = document.getElementById('card-grid');
    const totalCount = document.getElementById('total-count');
    const emptyState = document.getElementById('empty-state');
    const searchInput = document.getElementById('search-input');
    const filterFavoritesOnly = document.getElementById('filter-favorites-only');
    const filterShowBlacklisted = document.getElementById('filter-show-blacklisted');
    const btnExportAll = document.getElementById('btn-export-all');
    const btnSyncToLocal = document.getElementById('btn-sync-to-local');
    const autoSyncCheckbox = document.getElementById('auto-sync-checkbox');
    const btnSyncAllConfig = document.getElementById('btn-sync-all-config');
    const btnClearAll = document.getElementById('btn-clear-all');
    const btnBatchAiScore = document.getElementById('btn-batch-ai-score');

    // Sidebar elements
    const navItems = document.querySelectorAll('.sidebar .nav li[data-target]');

    // Modal elements
    const modalOverlay = document.getElementById('detail-modal');
    const modalCloseBtn = document.getElementById('modal-close-btn');

    const kanbanContainer = document.getElementById('kanban-container');

    // AI DOM elements
    const modelSettingsContainer = document.getElementById('model-settings-container');
    const resumeSettingsContainer = document.getElementById('resume-settings-container');

    const aiProfileList = document.getElementById('ai-profile-list');
    const btnAddAiProfile = document.getElementById('btn-add-ai-profile');
    const btnDeleteAiProfile = document.getElementById('btn-delete-ai-profile');
    const aiProfileName = document.getElementById('ai-profile-name');

    const aiApiUrl = document.getElementById('ai-api-url');
    const aiApiKey = document.getElementById('ai-api-key');
    const aiModel = document.getElementById('ai-model');
    const aiResume = document.getElementById('ai-resume');
    const btnSaveModelSettings = document.getElementById('btn-save-model-settings');
    const btnSaveResumeSettings = document.getElementById('btn-save-resume-settings');
    const btnTestAi = document.getElementById('btn-test-ai');

    function renderAiProfiles() {
        if (!aiProfileList) return;
        aiProfileList.innerHTML = '';
        if (!aiSettings.profiles) aiSettings.profiles = [];

        aiSettings.profiles.forEach(p => {
            const div = document.createElement('div');
            const isActive = p.id === aiSettings.activeProfileId;
            div.style.cssText = `padding: 12px 16px; margin-bottom: 8px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; transition: all 0.2s; border: 1px solid ${isActive ? '#007bff' : 'transparent'}; background: ${isActive ? '#f0f7ff' : 'transparent'};`;

            div.onmouseover = () => { if (!isActive) div.style.background = '#f0f0f0'; };
            div.onmouseout = () => { if (!isActive) div.style.background = 'transparent'; };

            div.innerHTML = `
                <div style="font-weight: 500; color: ${isActive ? '#007bff' : '#333'}; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;">${p.name || '未命名配置'}</div>
                ${isActive ? '<div style="width: 8px; height: 8px; border-radius: 50%; background: #007bff; flex-shrink: 0;"></div>' : ''}
            `;

            div.addEventListener('click', () => {
                aiSettings.activeProfileId = p.id;
                chrome.storage.local.set({ ai_settings: aiSettings }, () => {
                    renderAiProfiles();
                });
            });
            aiProfileList.appendChild(div);
        });
        populateAiForm();
    }

    function populateAiForm() {
        if (!aiProfileName) return;
        const active = getActiveAiProfile();
        aiProfileName.value = active.name || '';
        aiApiUrl.value = active.url || '';
        aiApiKey.value = active.key || '';
        aiModel.value = active.model || '';

        if (aiSettings.profiles.length <= 1) {
            btnDeleteAiProfile.style.display = 'none';
        } else {
            btnDeleteAiProfile.style.display = 'block';
        }
    }

    if (btnAddAiProfile) {
        btnAddAiProfile.addEventListener('click', () => {
            const newId = 'profile_' + Date.now();
            aiSettings.profiles.push({
                id: newId,
                name: '新配置',
                url: '',
                key: '',
                model: ''
            });
            aiSettings.activeProfileId = newId;
            chrome.storage.local.set({ ai_settings: aiSettings }, () => {
                renderAiProfiles();
            });
        });
    }

    if (btnDeleteAiProfile) {
        btnDeleteAiProfile.addEventListener('click', () => {
            if (aiSettings.profiles.length <= 1) return;
            if (confirm('确定要删除当前选中的配置吗？')) {
                aiSettings.profiles = aiSettings.profiles.filter(p => p.id !== aiSettings.activeProfileId);
                aiSettings.activeProfileId = aiSettings.profiles[0].id;
                chrome.storage.local.set({ ai_settings: aiSettings }, () => {
                    renderAiProfiles();
                });
            }
        });
    }

    if (btnSaveModelSettings) {
        btnSaveModelSettings.addEventListener('click', () => {
            const active = aiSettings.profiles.find(p => p.id === aiSettings.activeProfileId);
            if (active) {
                active.name = aiProfileName.value.trim() || '未命名配置';
                active.url = aiApiUrl.value.trim();
                active.key = aiApiKey.value.trim();
                active.model = aiModel.value.trim();
                chrome.storage.local.set({ ai_settings: aiSettings }, () => {
                    showStatus('大模型配置保存成功！', 'success');
                    renderAiProfiles();
                });
            }
        });
    }

    if (btnSaveResumeSettings) {
        btnSaveResumeSettings.addEventListener('click', () => {
            aiSettings.resume = aiResume.value.trim();
            chrome.storage.local.set({ ai_settings: aiSettings }, () => {
                showStatus('简历保存成功！', 'success');
            });
        });
    }

    if (btnTestAi) {
        btnTestAi.addEventListener('click', async () => {
            const url = aiApiUrl.value.trim();
            const key = aiApiKey.value.trim();
            const model = aiModel.value.trim();

            if (!url || !key || !model) {
                showStatus('请填写完整的 API URL、API Key 和模型名称！', 'error');
                return;
            }

            try {
                // 动态申请API域名权限
                let apiUrlObj;
                try {
                    apiUrlObj = new URL(url);
                } catch (e) {
                    throw new Error('API URL 格式不正确，请包含 http:// 或 https://');
                }
                const origin = `${apiUrlObj.protocol}//${apiUrlObj.host}/*`;

                const granted = await new Promise((resolve, reject) => {
                    chrome.permissions.request({ origins: [origin] }, (res) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else {
                            resolve(res);
                        }
                    });
                });

                if (!granted) {
                    throw new Error('浏览器拒绝了授权请求（可能由于无用户交互或用户取消）。请注意：点击测试后，请留意浏览器顶部弹出的权限申请小框，并点击“允许”。');
                }

                btnTestAi.textContent = '测试中...';
                btnTestAi.disabled = true;

                // 发送测试请求到 background.js
                const response = await new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage({
                        action: 'testConnection',
                        url: url,
                        key: key,
                        model: model
                    }, (res) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else if (res && res.success) {
                            resolve(res);
                        } else {
                            reject(new Error(res ? res.error : '未知错误'));
                        }
                    });
                });

                showStatus('连接成功！API 配置正确。', 'success');
            } catch (error) {
                showStatus(`请求失败: ${error.message}`, 'error');
            } finally {
                btnTestAi.textContent = '测试连接';
                btnTestAi.disabled = false;
            }
        });
    }

    let currentJob = null;

    const aiAnalysisScoreRow = document.getElementById('ai-score-card');
    const scoreCircle = document.getElementById('ai-score-circle');
    const scoreNum = document.getElementById('ai-score-num');
    const scoreLabel = document.getElementById('score-label');
    const scoreCompanyTitle = document.getElementById('score-company-title');
    const scoreJobTitle = document.getElementById('score-job-title');
    const btnGenerateIntro = document.getElementById('btn-generate-intro');
    const btnRegenerateIntro = document.getElementById('btn-regenerate-intro');
    const btnCopyIntro = document.getElementById('btn-copy-intro');
    const introductionContent = document.getElementById('introduction-content');
    const introText = document.getElementById('introduction-text');
    const introductionEmpty = document.getElementById('generator-desc');
    const introHeaderActions = document.getElementById('intro-header-actions');
    const aiAnalysisLoading = document.getElementById('ai-analysis-loading');
    const aiAnalysisEmpty = document.getElementById('ai-no-score-container');
    const aiAnalysisContentDiv = document.getElementById('ai-analysis-content');
    const aiScoreContainer = document.getElementById('ai-score-container');

    // Interview DOM elements
    const interviewModal = document.getElementById('interview-modal');
    const interviewModalCloseBtn = document.getElementById('interview-modal-close-btn');
    const interviewJobTitle = document.getElementById('interview-job-title');
    const interviewRawText = document.getElementById('interview-raw-text');
    const btnAiParseInterview = document.getElementById('btn-ai-parse-interview');
    const interviewAiLoading = document.getElementById('interview-ai-loading');
    const interviewStartTime = document.getElementById('interview-start-time');
    const interviewEndTime = document.getElementById('interview-end-time');
    const interviewLocation = document.getElementById('interview-location');
    const interviewNotes = document.getElementById('interview-notes');
    const interviewDebrief = document.getElementById('interview-debrief');
    const btnExportIcs = document.getElementById('btn-export-ics');
    const btnSaveInterview = document.getElementById('btn-save-interview');

    let currentInterviewJob = null;



    function mergeAndDeduplicate(datasets) {
        const mergedMap = new Map();

        const allNormalized = [];
        if (datasets.boss) allNormalized.push(...datasets.boss.map(j => normalizeJob(j, 'boss')));
        if (datasets['51job']) allNormalized.push(...datasets['51job'].map(j => normalizeJob(j, '51job')));
        if (datasets.liepin) allNormalized.push(...datasets.liepin.map(j => normalizeJob(j, 'liepin')));
        if (datasets.zhilian) allNormalized.push(...datasets.zhilian.map(j => normalizeJob(j, 'zhilian')));

        allNormalized.forEach(job => {
            if (!job['职位名称'] || !job['公司全称']) return;
            const key = job['公司全称'] + '|||' + job['职位名称'];
            if (mergedMap.has(key)) {
                const existing = mergedMap.get(key);
                if (!existing['平台'].includes(job['平台'])) {
                    existing['平台'] += ', ' + job['平台'];
                }
            } else {
                mergedMap.set(key, { ...job });
            }
        });

        return Array.from(mergedMap.values());
    }

    let chartSalary = null;
    let chartExp = null;

    function renderDashboard(data) {
        document.getElementById('card-grid-container').style.display = 'none';
        document.getElementById('dashboard-container').style.display = 'block';

        const salaryDist = { '10k以下': 0, '10-20k': 0, '20-30k': 0, '30k以上': 0, '未知': 0 };
        const expDist = {};

        data.forEach(job => {
            const salary = String(job['薪资待遇'] || '');
            const kMatches = [...salary.matchAll(/(\d+)\s*[kK]/g)];
            if (kMatches.length > 0) {
                const maxK = Math.max(...kMatches.map(m => parseInt(m[1], 10)));
                if (maxK < 10) salaryDist['10k以下']++;
                else if (maxK <= 20) salaryDist['10-20k']++;
                else if (maxK <= 30) salaryDist['20-30k']++;
                else salaryDist['30k以上']++;
            } else {
                salaryDist['未知']++;
            }

            let exp = String(job['工作经验'] || '未知');
            if (exp.includes('3-5')) exp = '3-5年';
            else if (exp.includes('1-3')) exp = '1-3年';
            else if (exp.includes('5-10')) exp = '5-10年';
            else if (exp.includes('10')) exp = '10年以上';
            else exp = '其他/不限';

            expDist[exp] = (expDist[exp] || 0) + 1;
        });

        const ctxSalary = document.getElementById('chart-salary').getContext('2d');
        if (chartSalary) chartSalary.destroy();
        chartSalary = new Chart(ctxSalary, {
            type: 'bar',
            data: {
                labels: Object.keys(salaryDist),
                datasets: [{
                    label: '职位数量',
                    data: Object.values(salaryDist),
                    backgroundColor: '#3498db'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false
            }
        });

        const ctxExp = document.getElementById('chart-experience').getContext('2d');
        if (chartExp) chartExp.destroy();
        chartExp = new Chart(ctxExp, {
            type: 'pie',
            data: {
                labels: Object.keys(expDist),
                datasets: [{
                    data: Object.values(expDist),
                    backgroundColor: ['#e74c3c', '#f1c40f', '#2ecc71', '#9b59b6', '#95a5a6']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false
            }
        });

        const skillsDist = {};
        data.forEach(job => {
            let tags = job['技能标签'] || '';
            if (typeof tags === 'string') {
                tags = tags.split(',').map(t => t.trim()).filter(t => t);
            }
            if (Array.isArray(tags)) {
                tags.forEach(t => {
                    skillsDist[t] = (skillsDist[t] || 0) + 1;
                });
            }
        });

        const wordCloudCanvas = document.getElementById('chart-skills-wordcloud-canvas');
        if (wordCloudCanvas && typeof WordCloud === 'function') {
            const sortedSkills = Object.entries(skillsDist)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 80);

            if (sortedSkills.length === 0) {
                const ctx = wordCloudCanvas.getContext('2d');
                ctx.clearRect(0, 0, wordCloudCanvas.width, wordCloudCanvas.height);
                ctx.font = '16px Arial';
                ctx.fillStyle = '#888';
                ctx.textAlign = 'center';
                ctx.fillText('暂无技能数据', wordCloudCanvas.width / 2, wordCloudCanvas.height / 2);
            } else {
                wordCloudCanvas.width = wordCloudCanvas.parentElement.clientWidth || 800;
                wordCloudCanvas.height = wordCloudCanvas.parentElement.clientHeight || 250;

                const maxCount = sortedSkills[0][1];
                const minCount = sortedSkills[sortedSkills.length - 1][1];

                const list = sortedSkills.map(([skill, count]) => {
                    let weight = 14;
                    if (maxCount > minCount) {
                        weight = 14 + ((count - minCount) / (maxCount - minCount)) * 36;
                    } else {
                        weight = 20;
                    }
                    return [skill, weight];
                });

                WordCloud(wordCloudCanvas, {
                    list: list,
                    fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
                    color: function () {
                        const colors = ['#3498db', '#e74c3c', '#2ecc71', '#e67e22', '#9b59b6', '#34495e', '#1abc9c', '#e84393', '#6c5ce7', '#00cec9'];
                        return colors[Math.floor(Math.random() * colors.length)];
                    },
                    backgroundColor: '#fff',
                    rotateRatio: 0.3,
                    rotationSteps: 2,
                    gridSize: 8,
                    weightFactor: 1,
                    shape: 'circle'
                });
            }
        }
    }

    // ===== 数据加载逻辑 =====
    function loadData() {
        if (!currentSource) return;
        updateActionButtons();

        const topbar = document.querySelector('.topbar');
        if (topbar) {
            const listSources = ['boss-data', 'zhilian-data', '51job-data', 'liepin-data', 'merged-data'];
            if (listSources.includes(currentSource)) {
                topbar.style.display = 'flex';
            } else {
                topbar.style.display = 'none';
            }
        }

        document.getElementById('card-grid-container').style.display = 'none';
        document.getElementById('dashboard-container').style.display = 'none';
        if (modelSettingsContainer) modelSettingsContainer.style.display = 'none';
        if (resumeSettingsContainer) resumeSettingsContainer.style.display = 'none';
        const qbContainer = document.getElementById('question-bank-container');
        if (qbContainer) qbContainer.style.display = 'none';
        kanbanContainer.style.display = 'none';

        if (currentSource === 'question-bank') {
            if (qbContainer) qbContainer.style.display = 'block';
            renderQuestionBank();
            return;
        }

        if (currentSource === 'model-settings') {
            modelSettingsContainer.style.display = 'block';
            return;
        }

        if (currentSource === 'resume-settings') {
            resumeSettingsContainer.style.display = 'flex';
            return;
        }

        if (currentSource === 'kanban-board') {
            kanbanContainer.style.display = 'block';
            chrome.storage.local.get(['boss_scraped_v2', 'boss_single_details', '51job_scraped_v2', '51job_single_details', 'liepin_scraped_data_v1', 'liepin_single_details', 'zhilian_scraped_v2', 'zhilian_single_details', 'zhilian_scraped_data_v1', 'zhilian_scraped_data_v2', 'zhilian_enrichment_cache', 'user_job_tags'], (res) => {
                window.zhilianEnrichmentCache = res.zhilian_enrichment_cache || {};
                window.userJobTags = res.user_job_tags || {};

                // 兼容之前没有同步详情的记录，将 boss_single_details 合并进 boss_scraped_v2
                if (res.boss_scraped_v2 && res.boss_single_details) {
                    const detailsDict = {};
                    res.boss_single_details.forEach(d => { if (d['职位ID']) detailsDict[d['职位ID']] = d; });
                    res.boss_scraped_v2.forEach(job => {
                        const jobId = job.jobId || job['职位ID'] || (job.zpData && job.zpData.jobInfo && job.zpData.jobInfo.encryptId) || (job.jobInfo && job.jobInfo.encryptId);
                        const detail = detailsDict[jobId];
                        if (detail) {
                            for (const key of Object.keys(detail)) {
                                if (detail[key] && detail[key] !== '' && !job[key]) {
                                    job[key] = detail[key];
                                }
                            }
                        }
                    });
                }

                // 兼容 51job 详情库，将 51job_single_details 合并进 51job_scraped_v2
                let job51List = res['51job_scraped_v2'] || [];
                if (res['51job_single_details'] && res['51job_single_details'].length > 0) {
                    const job51DetailsDict = {};
                    res['51job_single_details'].forEach(d => { if (d['职位ID']) job51DetailsDict[d['职位ID']] = d; });
                    job51List.forEach(job => {
                        const jId = String(job.jobId || job['职位ID'] || '');
                        const d = job51DetailsDict[jId];
                        if (d) {
                            for (const key of Object.keys(d)) {
                                if (d[key] && d[key] !== '' && !job[key]) {
                                    job[key] = d[key];
                                }
                            }
                        }
                    });
                    const existing51Ids = new Set(job51List.map(j => String(j.jobId || j['职位ID'] || '')));
                    const standalone51 = res['51job_single_details'].filter(d => d['职位ID'] && !existing51Ids.has(String(d['职位ID'])));
                    job51List = [...job51List, ...standalone51];
                }

                // 兼容猎聘详情库，将 liepin_single_details 合并进 liepin_scraped_data_v1
                let liepinList = res['liepin_scraped_data_v1'] || [];
                if (res.liepin_single_details && res.liepin_single_details.length > 0) {
                    const lpDetailsDict = {};
                    res.liepin_single_details.forEach(d => { if (d['职位ID']) lpDetailsDict[d['职位ID']] = d; });
                    liepinList.forEach(job => {
                        const jId = (job.job && job.job.jobId) || job.jobId || job['职位ID'];
                        const d = lpDetailsDict[jId];
                        if (d) {
                            for (const key of Object.keys(d)) {
                                if (d[key] && d[key] !== '' && !job[key]) {
                                    job[key] = d[key];
                                }
                            }
                        }
                    });
                    const existingLpIds = new Set(liepinList.map(j => (j.job && j.job.jobId) || j.jobId || j['职位ID']));
                    const standaloneLp = res.liepin_single_details.filter(d => d['职位ID'] && !existingLpIds.has(d['职位ID']));
                    liepinList = [...liepinList, ...standaloneLp];
                }

                // 兼容智联详情库，将 zhilian_single_details 合并进 zhilian 列表
                let zhilianList = [...(res['zhilian_scraped_v2'] || []), ...(res['zhilian_scraped_data_v2'] || []), ...(res['zhilian_scraped_data_v1'] || [])];
                if (res.zhilian_single_details) {
                    const zlDetailsDict = {};
                    res.zhilian_single_details.forEach(d => { if (d['职位ID']) zlDetailsDict[d['职位ID']] = d; });
                    zhilianList.forEach(job => {
                        const jId = job.jobId || job['职位ID'] || job.number;
                        const detail = zlDetailsDict[jId];
                        if (detail) {
                            for (const key of Object.keys(detail)) {
                                if (detail[key] && detail[key] !== '' && !job[key]) {
                                    job[key] = detail[key];
                                }
                            }
                        }
                    });
                    const existingZlIds = new Set(zhilianList.map(j => j.jobId || j['职位ID'] || j.number));
                    const standaloneZl = res.zhilian_single_details.filter(d => d['职位ID'] && !existingZlIds.has(d['职位ID']));
                    zhilianList = [...zhilianList, ...standaloneZl];
                }

                const datasets = {
                    boss: res['boss_scraped_v2'] || [],
                    '51job': job51List,
                    liepin: liepinList,
                    zhilian: zhilianList
                };
                allData = mergeAndDeduplicate(datasets);
                renderKanban(allData);
            });
            return;
        }

        if (currentSource === 'merged-data' || currentSource === 'dashboard-data') {
            chrome.storage.local.get(['boss_scraped_v2', 'boss_single_details', '51job_scraped_v2', '51job_single_details', 'liepin_scraped_data_v1', 'liepin_single_details', 'zhilian_scraped_v2', 'zhilian_single_details', 'zhilian_scraped_data_v1', 'zhilian_scraped_data_v2', 'zhilian_enrichment_cache', 'user_job_tags', 'boss_companies_scraped', '51job_companies_scraped', 'liepin_companies_db_v1', 'zhilian_company_cache'], (res) => {
                window.zhilianEnrichmentCache = res.zhilian_enrichment_cache || {};
                window.userJobTags = res.user_job_tags || {};

                // 兼容之前没有同步详情的记录，将 boss_single_details 合并进 boss_scraped_v2
                if (res.boss_scraped_v2 && res.boss_single_details) {
                    const detailsDict = {};
                    res.boss_single_details.forEach(d => { if (d['职位ID']) detailsDict[d['职位ID']] = d; });
                    res.boss_scraped_v2.forEach(job => {
                        const jobId = job.jobId || job['职位ID'] || (job.zpData && job.zpData.jobInfo && job.zpData.jobInfo.encryptId) || (job.jobInfo && job.jobInfo.encryptId);
                        const detail = detailsDict[jobId];
                        if (detail) {
                            for (const key of Object.keys(detail)) {
                                if (detail[key] && detail[key] !== '' && !job[key]) {
                                    job[key] = detail[key];
                                }
                            }
                        }
                    });
                }

                // 兼容 51job 详情库，将 51job_single_details 合并进 51job_scraped_v2
                let job51List = res['51job_scraped_v2'] || [];
                if (res['51job_single_details'] && res['51job_single_details'].length > 0) {
                    const job51DetailsDict = {};
                    res['51job_single_details'].forEach(d => { if (d['职位ID']) job51DetailsDict[d['职位ID']] = d; });
                    job51List.forEach(job => {
                        const jId = String(job.jobId || job['职位ID'] || '');
                        const d = job51DetailsDict[jId];
                        if (d) {
                            for (const key of Object.keys(d)) {
                                if (d[key] && d[key] !== '' && !job[key]) {
                                    job[key] = d[key];
                                }
                            }
                        }
                    });
                    const existing51Ids = new Set(job51List.map(j => String(j.jobId || j['职位ID'] || '')));
                    const standalone51 = res['51job_single_details'].filter(d => d['职位ID'] && !existing51Ids.has(String(d['职位ID'])));
                    job51List = [...job51List, ...standalone51];
                }

                // 兼容猎聘详情库，将 liepin_single_details 合并进 liepin_scraped_data_v1
                let liepinList = res['liepin_scraped_data_v1'] || [];
                if (res.liepin_single_details && res.liepin_single_details.length > 0) {
                    const lpDetailsDict = {};
                    res.liepin_single_details.forEach(d => { if (d['职位ID']) lpDetailsDict[d['职位ID']] = d; });
                    liepinList.forEach(job => {
                        const jId = (job.job && job.job.jobId) || job.jobId || job['职位ID'];
                        const d = lpDetailsDict[jId];
                        if (d) {
                            for (const key of Object.keys(d)) {
                                if (d[key] && d[key] !== '' && !job[key]) {
                                    job[key] = d[key];
                                }
                            }
                        }
                    });
                    const existingLpIds = new Set(liepinList.map(j => (j.job && j.job.jobId) || j.jobId || j['职位ID']));
                    const standaloneLp = res.liepin_single_details.filter(d => d['职位ID'] && !existingLpIds.has(d['职位ID']));
                    liepinList = [...liepinList, ...standaloneLp];
                }

                // 兼容智联详情库，将 zhilian_single_details 合并进 zhilian 列表
                let zhilianList = [...(res['zhilian_scraped_v2'] || []), ...(res['zhilian_scraped_data_v2'] || []), ...(res['zhilian_scraped_data_v1'] || [])];
                if (res.zhilian_single_details) {
                    const zlDetailsDict = {};
                    res.zhilian_single_details.forEach(d => { if (d['职位ID']) zlDetailsDict[d['职位ID']] = d; });
                    zhilianList.forEach(job => {
                        const jId = job.jobId || job['职位ID'] || job.number;
                        const detail = zlDetailsDict[jId];
                        if (detail) {
                            for (const key of Object.keys(detail)) {
                                if (detail[key] && detail[key] !== '' && !job[key]) {
                                    job[key] = detail[key];
                                }
                            }
                        }
                    });
                    const existingZlIds = new Set(zhilianList.map(j => j.jobId || j['职位ID'] || j.number));
                    const standaloneZl = res.zhilian_single_details.filter(d => d['职位ID'] && !existingZlIds.has(d['职位ID']));
                    zhilianList = [...zhilianList, ...standaloneZl];
                }

                window.zhilianEnrichmentCache = res.zhilian_enrichment_cache || {};
                window.userJobTags = res.user_job_tags || {};
                const datasets = {
                    boss: res['boss_scraped_v2'] || [],
                    '51job': job51List,
                    liepin: liepinList,
                    zhilian: zhilianList
                };
                const companyDatabases = {
                    boss: res['boss_companies_scraped'] || [],
                    '51job': res['51job_companies_scraped'] || [],
                    liepin: res['liepin_companies_db_v1'] || [],
                    zhilian: res['zhilian_company_cache'] ? Object.values(res['zhilian_company_cache']) : []
                };

                allData = mergeAndDeduplicate(datasets);

                if (currentSource === 'dashboard-data') {
                    renderDashboard(allData);
                } else {
                    document.getElementById('card-grid-container').style.display = 'none';
                    document.getElementById('company-centric-app').style.display = 'block';
                    renderCompanyCentricView(allData, companyDatabases);
                }
            });
            return;
        }

        document.getElementById('card-grid-container').style.display = 'block';
        document.getElementById('company-centric-app').style.display = 'none';
        document.getElementById('dashboard-container').style.display = 'none';

        let storageKeys = ['boss_scraped_v2', 'boss_single_details', 'user_job_tags'];
        if (currentSource === '51job-data') storageKeys = ['51job_scraped_v2', '51job_single_details', 'user_job_tags'];
        if (currentSource === 'liepin-data') storageKeys = ['liepin_scraped_data_v1', 'liepin_single_details', 'user_job_tags'];
        if (currentSource === 'zhilian-data') storageKeys = ['zhilian_scraped_v2', 'zhilian_single_details', 'zhilian_scraped_data_v2', 'zhilian_scraped_data_v1', 'zhilian_enrichment_cache', 'user_job_tags'];

        chrome.storage.local.get(storageKeys, (res) => {
            window.userJobTags = res.user_job_tags || {};
            if (res.zhilian_enrichment_cache) {
                window.zhilianEnrichmentCache = res.zhilian_enrichment_cache;
            }

            // 兼容之前没有同步详情的记录，将 boss_single_details 合并进 boss_scraped_v2
            if (res.boss_scraped_v2 && res.boss_single_details) {
                const detailsDict = {};
                res.boss_single_details.forEach(d => { if (d['职位ID']) detailsDict[d['职位ID']] = d; });
                res.boss_scraped_v2.forEach(job => {
                    const jobId = job.jobId || job['职位ID'] || (job.zpData && job.zpData.jobInfo && job.zpData.jobInfo.encryptId) || (job.jobInfo && job.jobInfo.encryptId);
                    const detail = detailsDict[jobId];
                    if (detail) {
                        for (const key of Object.keys(detail)) {
                            if (detail[key] && detail[key] !== '' && !job[key]) {
                                job[key] = detail[key];
                            }
                        }
                    }
                });
            }

            // 兼容 51job 详情库，将 51job_single_details 合并进 51job_scraped_v2
            if (res['51job_scraped_v2'] && res['51job_single_details']) {
                const job51DetailsDict = {};
                res['51job_single_details'].forEach(d => { if (d['职位ID']) job51DetailsDict[d['职位ID']] = d; });
                res['51job_scraped_v2'].forEach(job => {
                    const jId = String(job.jobId || job['职位ID'] || '');
                    const d = job51DetailsDict[jId];
                    if (d) {
                        for (const key of Object.keys(d)) {
                            if (d[key] && d[key] !== '' && !job[key]) {
                                job[key] = d[key];
                            }
                        }
                    }
                });
            }

            // 兼容猎聘详情库，将 liepin_single_details 合并进 liepin_scraped_data_v1
            if (res.liepin_scraped_data_v1 && res.liepin_single_details) {
                const lpDetailsDict = {};
                res.liepin_single_details.forEach(d => { if (d['职位ID']) lpDetailsDict[d['职位ID']] = d; });
                res.liepin_scraped_data_v1.forEach(job => {
                    const jId = (job.job && job.job.jobId) || job.jobId || job['职位ID'];
                    const detail = lpDetailsDict[jId];
                    if (detail) {
                        for (const key of Object.keys(detail)) {
                            if (detail[key] && detail[key] !== '' && !job[key]) {
                                job[key] = detail[key];
                            }
                        }
                    }
                });
            }

            let normalizedSource = currentSource.replace('-data', '');
            if (normalizedSource === 'boss') normalizedSource = 'boss';

            if (currentSource === 'zhilian-data') {
                const v2Raw = res['zhilian_scraped_v2'] || res['zhilian_scraped_data_v2'] || [];
                const v1Raw = res['zhilian_scraped_data_v1'] || [];
                const singleRaw = res['zhilian_single_details'] || [];

                let combinedZl = [...v2Raw, ...v1Raw];
                if (singleRaw.length > 0) {
                    const detailsDict = {};
                    singleRaw.forEach(d => { if (d['职位ID']) detailsDict[d['职位ID']] = d; });
                    combinedZl.forEach(job => {
                        const jId = job.jobId || job['职位ID'] || job.number;
                        const detail = detailsDict[jId];
                        if (detail) {
                            for (const key of Object.keys(detail)) {
                                if (detail[key] && detail[key] !== '' && !job[key]) {
                                    job[key] = detail[key];
                                }
                            }
                        }
                    });
                    const existingIds = new Set(combinedZl.map(j => j.jobId || j['职位ID'] || j.number));
                    const standaloneZl = singleRaw.filter(d => d['职位ID'] && !existingIds.has(d['职位ID']));
                    combinedZl = [...combinedZl, ...standaloneZl];
                }

                const normList = combinedZl.map(job => normalizeJob(job, 'zhilian'));
                const seenIds = new Set();
                const deduplicated = [];

                normList.forEach(job => {
                    const id = job['职位ID'] || (job['公司全称'] + '|||' + job['职位名称']);
                    if (!seenIds.has(id)) {
                        seenIds.add(id);
                        deduplicated.push(job);
                    }
                });

                allData = deduplicated;
            } else if (currentSource === 'liepin-data') {
                let rawData = [...(res['liepin_scraped_data_v1'] || [])];
                if (res.liepin_single_details && Array.isArray(res.liepin_single_details)) {
                    const existingLpIds = new Set(rawData.map(j => (j.job && j.job.jobId) || j.jobId || j['职位ID']));
                    const standaloneLp = res.liepin_single_details.filter(d => d['职位ID'] && !existingLpIds.has(d['职位ID']));
                    rawData = [...rawData, ...standaloneLp];
                }
                allData = rawData.map(job => normalizeJob(job, normalizedSource));
            } else if (currentSource === '51job-data') {
                let rawData = [...(res['51job_scraped_v2'] || [])];
                if (res['51job_single_details'] && Array.isArray(res['51job_single_details'])) {
                    const existing51Ids = new Set(rawData.map(j => String(j.jobId || j['职位ID'] || '')));
                    const standalone51 = res['51job_single_details'].filter(d => d['职位ID'] && !existing51Ids.has(String(d['职位ID'])));
                    rawData = [...rawData, ...standalone51];
                }
                allData = rawData.map(job => normalizeJob(job, normalizedSource));
            } else {
                let rawData = [];
                storageKeys.forEach(k => {
                    if (k !== 'zhilian_enrichment_cache' && k !== 'boss_single_details' && k !== 'liepin_single_details' && k !== '51job_single_details' && res[k] && Array.isArray(res[k])) rawData = rawData.concat(res[k]);
                });
                allData = rawData.map(job => normalizeJob(job, normalizedSource));
            }

            applyFilters();
            updateActionButtons();
        });
    }


    // 渲染卡片
    function renderCards(data) {
        currentDisplayedJobs = data;
        totalCount.textContent = data ? data.length : 0;
        const totalLabel = document.getElementById('total-label');
        if (totalLabel) totalLabel.textContent = '条数据';
        cardGrid.innerHTML = '';
        if (!data || data.length === 0) {
            cardGrid.innerHTML = '<div class="empty-state">当前没有数据。</div>';
            return;
        }

        data.forEach(job => {
            const card = document.createElement('div');
            card.className = 'card';

            const jobName = job['职位名称'] || '未知职位';
            let companyName = job['公司名称'] || '未知公司';
            let clientCompany = job['代理用人公司'] || '';
            let proxyTypeStr = job['岗位类型_外包猎头'] || '';

            if ((job['平台'] === 'Boss直聘' || job['平台'] === 'Liepin') && proxyTypeStr && proxyTypeStr.includes('猎头')) {
                clientCompany = companyName; // 原公司名作为客户公司
                companyName = job['HR所属公司'] || companyName; // 将卡片公司名替换为猎头公司
            }
            
            const salary = job['薪资待遇'] || '面议';
            const location = job['工作地点'] || '未知';
            const experience = job['工作经验'] || '不限';
            const degree = job['学历要求'] || '不限';
            let detailUrl = job['职位链接'] || job['干净链接'] || job['抓取源URL'] || (job['源数据'] && (job['源数据'].jobUrl || job['源数据'].jobHref || job['源数据'].link));
            if (!detailUrl && job['平台'] === 'Boss直聘' && job['职位ID']) {
                detailUrl = `https://www.zhipin.com/job_detail/${job['职位ID']}.html`;
            }
            if (!detailUrl) detailUrl = '#';
            const platform = job['平台'] || '';

            let tagsHtml = '';
            let tags = job['技能标签'] || '';
            if (typeof tags === 'string') {
                tags = tags.split(',').filter(t => t.trim());
            }
            if (Array.isArray(tags)) {
                tagsHtml = tags.slice(0, 3).map(tag => `<span class="card-tag">${tag}</span>`).join('');
            }

            const jobId = getJobId(job);
            const isFav = favoritedJobs.includes(jobId);
            const isBlacklisted = blacklistedCompanies.includes(companyName);

            if (isBlacklisted) {
                card.classList.add('blacklisted-card');
            }

            const aiScoreData = aiScores[jobId];
            let aiScoreElement = '';
            if (aiScoreData) {
                let textColor = '#b91c1c'; // Deeper red
                let bgColor = '#fee2e2';

                if (aiScoreData.matchLevel === '高匹配') {
                    textColor = '#15803d'; // Deeper green
                    bgColor = '#dcfce3';
                } else if (aiScoreData.matchLevel === '中匹配') {
                    textColor = '#c2410c'; // Deeper orange
                    bgColor = '#ffedd5';
                }

                aiScoreElement = `<div style="display: flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 50%; background-color: ${bgColor}; color: ${textColor}; font-size: 15px; font-weight: bold; margin-left: 12px; flex-shrink: 0; box-shadow: 0 2px 6px rgba(0,0,0,0.04);">${aiScoreData.score}分</div>`;
            }

            let proxyTagsHtml = '';
            if (proxyTypeStr) {
                proxyTypeStr.split(',').forEach(type => {
                    if (type.trim()) {
                        proxyTagsHtml += `<span class="card-tag" style="background-color: #fce4ec; color: #c2185b; border: 1px solid #f8bbd0;">${type.trim()}</span>`;
                    }
                });
            }
            if (clientCompany) {
                proxyTagsHtml += `<span class="card-tag" style="background-color: #e3f2fd; color: #1976d2; border: 1px solid #bbdefb;">客户公司: ${clientCompany}</span>`;
            }

            const rawSource = job['源数据'] || {};
            const liepinJob = rawSource.job || {};
            const refreshTime = liepinJob.refreshTime || rawSource.refreshTime || '';
            const jobProps = (rawSource.jobDetailJson && rawSource.jobDetailJson.supplementalDomData && rawSource.jobDetailJson.supplementalDomData.jobProperties) || '';

            let hiddenTagHtml = job['是否隐藏'] ? `<div class="card-tags" style="margin-top: 8px; margin-bottom: 12px;"><span class="card-tag" style="background-color: #ffebee; color: #d32f2f; border: 1px solid #ef9a9a; font-weight: bold;">[失效/不合适] ${(job['人工标签'] || []).join('、')}</span></div>` : '';

            card.innerHTML = `
                <div class="card-header" style="align-items: center;">
                    <h3 class="card-title" title="${jobName}" style="display: flex; align-items: center; margin: 0; flex-wrap: wrap;">
                        <span style="margin-right: 12px;">${jobName}</span>
                        <span class="card-salary" style="margin: 0;">${salary}</span>
                    </h3>
                    ${aiScoreElement}
                </div>
                <div class="card-company" title="${companyName}">${companyName}</div>
                <div class="card-tags">
                    ${platform ? `<span class="card-tag" style="background-color: #e8eaed; color: #5f6368;">${platform}</span>` : ''}
                    <span class="card-tag">${location}</span>
                    <span class="card-tag">${experience}</span>
                    <span class="card-tag">${degree}</span>
                    ${tagsHtml}
                    ${proxyTagsHtml}
                </div>
                <div class="card-timeline" style="font-size: 12px; color: #7f8c8d; margin-bottom: 12px; display: flex; flex-wrap: wrap; gap: 12px; border-top: 1px dashed #eee; padding-top: 8px;">
                    ${job['发布时间'] ? `<span title="${job['发布时间']}"><span style="color:#bdc3c7">首发:</span> ${job['发布时间'].split('T')[0]}</span>` : ''}
                    ${job['页面更新时间'] ? `<span title="${job['页面更新时间']}"><span style="color:#bdc3c7">修改:</span> ${job['页面更新时间'].split('T')[0]}</span>` : ''}
                    ${refreshTime ? `<span><span style="color:#bdc3c7">刷新:</span> ${refreshTime}</span>` : ''}
                    ${jobProps ? `<span><span style="color:#bdc3c7">状态:</span> ${jobProps.split(/\s+/).pop()}</span>` : ''}
                </div>
                ${hiddenTagHtml}
                <div class="card-footer">
                    <div>
                        <button class="btn-small btn-favorite ${isFav ? 'active' : ''}">${isFav ? '⭐ 已收藏' : '☆ 收藏'}</button>
                        <button class="btn-small btn-unsuitable">👎 不合适</button>
                        <button class="btn-small btn-block">${isBlacklisted ? '⛔ 已拉黑' : '⛔ 拉黑'}</button>
                        <button class="btn-small btn-delete">删除</button>
                    </div>
                    <div>
                        <button class="btn-small btn-interview" style="background:#27ae60; color:#fff;">📅 面试</button>
                        <button class="btn-small btn-ai">🤖 AI 诊断</button>
                        <a href="${detailUrl}" target="_blank" class="btn-small card-link" style="background:#3498db; text-decoration:none; line-height:1.2;">详情 🔗</a>
                    </div>
                </div>
            `;
            cardGrid.appendChild(card);

            const favBtn = card.querySelector('.btn-favorite');
            if (favBtn) {
                favBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (favoritedJobs.includes(jobId)) {
                        favoritedJobs = favoritedJobs.filter(id => id !== jobId);
                    } else {
                        favoritedJobs.push(jobId);
                    }
                    chrome.storage.local.set({ favorited_jobs: favoritedJobs }, () => {
                        applyFilters(); // Re-render to show updated state
                    });
                });
            }

            const unsuitableBtn = card.querySelector('.btn-unsuitable');
            if (unsuitableBtn) {
                unsuitableBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openTagModal(jobId, job);
                });
            }

            const blockBtn = card.querySelector('.btn-block');
            if (blockBtn) {
                blockBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (blacklistedCompanies.includes(companyName)) {
                        blacklistedCompanies = blacklistedCompanies.filter(c => c !== companyName);
                    } else {
                        blacklistedCompanies.push(companyName);
                    }
                    chrome.storage.local.set({ blacklisted_companies: blacklistedCompanies }, () => {
                        applyFilters();
                    });
                });
            }

            const aiBtn = card.querySelector('.btn-ai');
            if (aiBtn) {
                aiBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    runAiDiagnosis(job, aiBtn);
                });
            }

            const interviewBtn = card.querySelector('.btn-interview');
            if (interviewBtn) {
                interviewBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openInterviewModal(job);
                });
            }

            card.addEventListener('click', (e) => {
                if (e.target.tagName !== 'A' && e.target.tagName !== 'BUTTON') {
                    openModal(job);
                }
            });

            const delBtn = card.querySelector('.btn-delete');
            if (delBtn) {
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteJob(job['职位ID']);
                });
            }
        });
    }

    // 看板渲染
    function renderKanban(data) {
        const columns = {
            'to-apply': kanbanContainer.querySelector('[data-status="to-apply"] .kanban-cards'),
            'applied': kanbanContainer.querySelector('[data-status="applied"] .kanban-cards'),
            'interview-1': kanbanContainer.querySelector('[data-status="interview-1"] .kanban-cards'),
            'interview-2': kanbanContainer.querySelector('[data-status="interview-2"] .kanban-cards'),
            'offer': kanbanContainer.querySelector('[data-status="offer"] .kanban-cards')
        };

        // 清空容器
        for (let key in columns) {
            columns[key].innerHTML = '';
        }

        let counts = { 'to-apply': 0, 'applied': 0, 'interview-1': 0, 'interview-2': 0, 'offer': 0 };

        data.forEach(job => {
            const jobId = getJobId(job);
            const isFav = favoritedJobs.includes(jobId);
            let status = jobStatuses[jobId];

            // 如果没有状态，但被收藏了，默认进 'to-apply'
            if (!status && isFav) {
                status = 'to-apply';
            }

            if (status && columns[status]) {
                const card = document.createElement('div');
                card.className = 'kanban-card';
                card.draggable = true;
                card.dataset.jobId = jobId;

                const jobName = job['职位名称'] || '未知职位';
                let companyName = job['公司名称'] || '未知公司';
                let proxyTypeStr = job['岗位类型_外包猎头'] || '';
                if ((job['平台'] === 'Boss直聘' || job['平台'] === 'Liepin') && proxyTypeStr && proxyTypeStr.includes('猎头')) {
                    companyName = job['HR所属公司'] || companyName;
                }
                const salary = job['薪资待遇'] || '面议';

                const aiScoreData = aiScores[jobId];
                let aiBadge = '';
                if (aiScoreData) {
                    let badgeColor = aiScoreData.matchLevel === '高匹配' ? '#2ecc71' : (aiScoreData.matchLevel === '中匹配' ? '#f39c12' : '#e74c3c');
                    aiBadge = `<span style="margin-left: 5px; font-size: 10px; padding: 1px 4px; border-radius: 8px; background-color: ${badgeColor}; color: white;">AI ${aiScoreData.score}分</span>`;
                }

                card.innerHTML = `
                    <div class="job-title" title="${jobName}">${jobName}${aiBadge}</div>
                    <div class="company" title="${companyName}">${companyName}</div>
                    <div class="footer">
                        <span class="salary">${salary}</span>
                        <div>
                            <button class="btn-small btn-interview" style="padding: 2px 5px; font-size: 11px; background:#27ae60; color:#fff;">📅</button>
                            <button class="btn-small btn-ai" style="padding: 2px 5px; font-size: 11px;">AI</button>
                        </div>
                    </div>
                `;

                // 绑定AI诊断按钮
                const aiBtn = card.querySelector('.btn-ai');
                if (aiBtn) {
                    aiBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        runAiDiagnosis(job, aiBtn);
                    });
                }

                const interviewBtn = card.querySelector('.btn-interview');
                if (interviewBtn) {
                    interviewBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        openInterviewModal(job);
                    });
                }

                card.addEventListener('click', (e) => {
                    if (e.target.tagName !== 'BUTTON') {
                        openModal(job);
                    }
                });

                // 拖拽事件
                card.addEventListener('dragstart', (e) => {
                    card.classList.add('dragging');
                    e.dataTransfer.setData('text/plain', jobId);
                });

                card.addEventListener('dragend', () => {
                    card.classList.remove('dragging');
                });

                columns[status].appendChild(card);
                counts[status]++;
            }
        });

        // 更新各列数量
        for (let key in counts) {
            const header = kanbanContainer.querySelector(`[data-status="${key}"] .kanban-column-header .count`);
            if (header) header.textContent = counts[key];
        }
    }

    // 绑定看板列的拖拽事件
    document.querySelectorAll('.kanban-column').forEach(column => {
        column.addEventListener('dragover', (e) => {
            e.preventDefault();
            const draggingCard = kanbanContainer.querySelector('.dragging');
            if (draggingCard) {
                column.classList.add('drag-over');
            }
        });

        column.addEventListener('dragleave', (e) => {
            column.classList.remove('drag-over');
        });

        column.addEventListener('drop', (e) => {
            e.preventDefault();
            column.classList.remove('drag-over');
            const draggingCard = kanbanContainer.querySelector('.dragging');
            if (draggingCard) {
                const targetCardsContainer = column.querySelector('.kanban-cards');
                targetCardsContainer.appendChild(draggingCard);

                const newStatus = column.dataset.status;
                const jobId = draggingCard.dataset.jobId;
                jobStatuses[jobId] = newStatus;

                // 保存并重新渲染更新 count
                chrome.storage.local.set({ job_statuses: jobStatuses }, () => {
                    // 重新计算 counts 可以简单处理，或者直接重新调用 renderKanban
                    if (allData) renderKanban(allData);
                });
            }
        });
    });

    function openModal(job) {
        window.currentModalJob = job;
        if (!job) return;
        currentJob = job;

        document.getElementById('modal-title').textContent = job['职位名称'] || '-';
        document.getElementById('modal-salary').textContent = job['薪资待遇'] || '-';
        document.getElementById('modal-company').textContent = job['公司名称'] || '-';

        const setSafeText = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };

        setSafeText('modal-working-location', job['工作地点'] || '-');
        setSafeText('modal-exp-val', job['工作经验'] || '不限');
        setSafeText('modal-edu-val', job['学历要求'] || '不限');
        setSafeText('modal-source-val', job['平台'] || job['采集来源'] || '未知来源');
        setSafeText('modal-industry', job['公司行业'] || '-');
        setSafeText('modal-scale', job['公司规模'] || '-');
        setSafeText('modal-stage', job['融资阶段'] || '-');
        setSafeText('modal-hr-name', job['HR姓名'] || '-');
        setSafeText('modal-hr-title', job['HR职位'] || '-');
        setSafeText('modal-hr-active', job['HR活跃度'] || '-');

        if (document.getElementById('modal-hr-company')) {
            setSafeText('modal-hr-company', job['HR所属公司'] || job['公司全称'] || job['公司名称'] || '-');
        }

        setSafeText('modal-create-time', job['创建时间'] || job['采集日期'] || '-');

        const modalDesc = document.getElementById('modal-desc');
        if (modalDesc) modalDesc.innerHTML = (job['职位描述'] || '-').replace(/\\n/g, '<br>');

        const address = job['详细完整地址'] || job['详细工作地址'] || job['详细地址'] || '-';
        document.getElementById('modal-address').textContent = address;

        document.getElementById('modal-issue-time').textContent = job['发布时间'] || job['页面更新时间'] || job['发布日期'] || '-';
        if (document.getElementById('modal-update-time')) {
            document.getElementById('modal-update-time').textContent = job['页面更新时间'] || job['更新时间'] || '-';
        }

        let detailUrl = job['职位链接'] || job['干净链接'] || job['抓取源URL'] || (job['源数据'] && (job['源数据'].jobUrl || job['源数据'].jobHref || job['源数据'].link));
        if (!detailUrl && job['平台'] === 'Boss直聘' && job['职位ID']) {
            detailUrl = `https://www.zhipin.com/job_detail/${job['职位ID']}.html`;
        }
        document.getElementById('modal-link-btn').href = detailUrl || '#';

        let tagsHtml = '';
        let tags = job['技能标签'] || '';
        if (typeof tags === 'string') tags = tags.split(',').filter(t => t.trim());
        if (Array.isArray(tags)) {
            tagsHtml = tags.map(tag => `<span class="benefit-tag">${tag}</span>`).join('');
        }
        const modalSkills = document.getElementById('modal-skills-tags');
        const modalSkillsTitle = document.getElementById('modal-skills-title');
        if (modalSkills) {
            modalSkills.innerHTML = tagsHtml;
            if (modalSkillsTitle) modalSkillsTitle.style.display = tagsHtml ? 'flex' : 'none';
        }

        let welfareHtml = '';
        let welfare = job['公司福利'] || '';
        if (typeof welfare === 'string') welfare = welfare.split(',').filter(t => t.trim());
        if (Array.isArray(welfare)) {
            welfareHtml = welfare.map(w => `<span class="benefit-tag">${w}</span>`).join('');
        }
        const modalWelfare = document.getElementById('modal-welfare-tags');
        const modalWelfareTitle = document.getElementById('modal-welfare-title');
        if (modalWelfare) {
            modalWelfare.innerHTML = welfareHtml;
            if (modalWelfareTitle) modalWelfareTitle.style.display = welfareHtml ? 'flex' : 'none';
        }

        // Reset AI sections
        if (aiScoreContainer) aiScoreContainer.style.display = 'none';
        if (aiAnalysisScoreRow) aiAnalysisScoreRow.style.display = 'none';
        if (aiAnalysisContentDiv) aiAnalysisContentDiv.style.display = 'none';
        if (aiAnalysisLoading) aiAnalysisLoading.style.display = 'none';

        const jobId = getJobId(job);
        if (aiScores[jobId]) {
            const savedScore = aiScores[jobId];
            if (aiAnalysisEmpty) aiAnalysisEmpty.style.display = 'none';
            if (aiScoreContainer) aiScoreContainer.style.display = 'block';
            if (aiAnalysisScoreRow) aiAnalysisScoreRow.style.display = 'flex';
            if (aiAnalysisContentDiv) aiAnalysisContentDiv.style.display = 'block';
            if (scoreCircle) {
                scoreCircle.classList.remove('高匹配', '中匹配', '低匹配', '不建议');
                scoreCircle.classList.add(savedScore.matchLevel);
            }
            if (scoreNum) scoreNum.textContent = savedScore.score;

            const aiMatchLevelEl = document.getElementById('ai-match-level');
            if (aiMatchLevelEl) {
                let badgeColor = savedScore.matchLevel === '高匹配' ? '#52c41a' : (savedScore.matchLevel === '中匹配' ? '#faad14' : '#ff4d4f');
                aiMatchLevelEl.textContent = savedScore.matchLevel;
                aiMatchLevelEl.style.backgroundColor = badgeColor;
                aiMatchLevelEl.style.color = 'white';
                aiMatchLevelEl.style.padding = '2px 8px';
                aiMatchLevelEl.style.borderRadius = '4px';
                aiMatchLevelEl.style.fontSize = '12px';
                aiMatchLevelEl.style.marginLeft = '8px';
                aiMatchLevelEl.style.display = 'inline-block';
            }

            const aiScoreTimeEl = document.getElementById('ai-score-time');
            if (aiScoreTimeEl) {
                if (savedScore.scoredAt) {
                    const date = new Date(savedScore.scoredAt);
                    aiScoreTimeEl.textContent = date.toLocaleString();
                } else {
                    aiScoreTimeEl.textContent = '最新评分';
                }
            }
            let htmlContent = savedScore.resultText.replace(/\n/g, '<br>');
            htmlContent = htmlContent.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            if (aiAnalysisContentDiv) aiAnalysisContentDiv.innerHTML = htmlContent;
            if (btnGenerateIntro) btnGenerateIntro.style.display = 'flex';
        } else {
            if (aiAnalysisEmpty) aiAnalysisEmpty.style.display = 'flex';
        }

        if (aiIntros[jobId]) {
            if (introductionContent) introductionContent.style.display = 'flex';
            if (introductionEmpty) introductionEmpty.style.display = 'none';
            if (introText) introText.innerHTML = aiIntros[jobId];
            if (introHeaderActions) introHeaderActions.style.display = 'flex';
        } else {
            if (introductionContent) introductionContent.style.display = 'none';
            if (introductionEmpty) introductionEmpty.style.display = 'block';
            if (introHeaderActions) introHeaderActions.style.display = 'none';
        }

        // Set Job titles in right panel
        if (scoreCompanyTitle) scoreCompanyTitle.textContent = job['公司名称'] || '';
        if (scoreJobTitle) scoreJobTitle.textContent = job['职位名称'] || '';

        modalOverlay.classList.add('active');
    }

    function closeModal() {
        modalOverlay.classList.remove('active');
        currentJob = null;
    }

    async function scoreJobBackground(job, btnElement) {
        const activeAi = getActiveAiProfile();
        if (!activeAi.url || !activeAi.key || !activeAi.model || !aiSettings.resume) {
            showStatus('请先在左侧【⚙️ AI 诊断设置】中配置完整的 API 信息和你的简历！', 'error');
            document.querySelector('[data-target="ai-settings"]').click();
            return false;
        }

        const jobDesc = job['职位描述'] || '';
        const jobTitle = job['职位名称'] || '';
        const company = job['公司名称'] || '';
        const reqs = `薪资: ${job['薪资待遇'] || ''}, 经验: ${job['工作经验'] || ''}, 学历: ${job['学历要求'] || ''}`;

        if (btnElement) {
            btnElement.disabled = true;
            btnElement.innerHTML = '<span style="color:#666;">🔄 诊断中...</span>';
        }

        try {
            let apiUrlObj;
            try { apiUrlObj = new URL(activeAi.url); } catch (e) { throw new Error('API URL 格式不正确'); }
            const origin = `${apiUrlObj.protocol}//${apiUrlObj.host}/*`;

            const granted = await new Promise(resolve => {
                chrome.permissions.contains({ origins: [origin] }, (hasPerm) => {
                    if (hasPerm) {
                        resolve(true);
                    } else {
                        chrome.permissions.request({ origins: [origin] }, (res) => {
                            if (chrome.runtime.lastError) {
                                console.warn(chrome.runtime.lastError);
                                resolve(false);
                            } else {
                                resolve(res);
                            }
                        });
                    }
                });
            });
            if (!granted) throw new Error('需要授权才能访问 API，请在单条职位中点击诊断以授予权限');

            const response = await (async () => {
                let retries = 3;
                let lastError = null;
                while (retries > 0) {
                    try {
                        return await new Promise((resolve, reject) => {
                            chrome.runtime.sendMessage({
                                action: 'aiScoreJob',
                                url: activeAi.url,
                                key: activeAi.key,
                                model: activeAi.model,
                                resume: aiSettings.resume,
                                company: company,
                                jobTitle: jobTitle,
                                reqs: reqs,
                                jobDesc: jobDesc
                            }, (res) => {
                                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                                else if (res && res.success) resolve(res);
                                else reject(new Error(res ? res.error : '未知错误'));
                            });
                        });
                    } catch (error) {
                        lastError = error;
                        const errMsg = error.message.toLowerCase();
                        // 如果是超时、并发超限、429 等代理层报错，等待后重试
                        if (errMsg.includes('token') || errMsg.includes('timeout') || errMsg.includes('busy') || errMsg.includes('deadlock') || errMsg.includes('429')) {
                            retries--;
                            if (retries > 0) {
                                console.warn(`API 请求遇到限流或超时，等待 3 秒后重试... 剩余重试次数: ${retries}`, error.message);
                                await new Promise(r => setTimeout(r, 3000));
                            }
                        } else {
                            throw error; // 其他错误直接抛出不重试
                        }
                    }
                }
                throw lastError;
            })();

            const jobId = getJobId(job);
            aiScores[jobId] = {
                score: response.score,
                matchLevel: response.matchLevel,
                resultText: response.resultText,
                scoredAt: new Date().toISOString()
            };
            chrome.storage.local.set({ ai_job_scores: aiScores });
            applyFilters();
            return true;
        } catch (error) {
            showStatus(`评分失败: ${error.message}`, 'error');
            if (btnElement) {
                btnElement.disabled = false;
                btnElement.innerHTML = '⚡ AI 诊断';
            }
            return false;
        }
    }

    function runAiDiagnosis(job, btnElement = null) {
        scoreJobBackground(job, btnElement);
    }

    let isBatchAiRunning = false;
    let isBatchAiPaused = false;

    if (btnBatchAiScore) {
        btnBatchAiScore.addEventListener('click', async () => {
            if (isBatchAiRunning) {
                isBatchAiPaused = !isBatchAiPaused;
                if (isBatchAiPaused) {
                    btnBatchAiScore.textContent = '▶ 继续 AI 诊断';
                    showStatus('批量诊断已暂停', 'info');
                } else {
                    btnBatchAiScore.textContent = '诊断中...';
                    showStatus('批量诊断已继续', 'info');
                }
                return;
            }

            if (!currentDisplayedJobs || currentDisplayedJobs.length === 0) {
                showStatus('当前列表为空', 'warning');
                return;
            }

            const activeAi = getActiveAiProfile();
            if (!activeAi.url || !activeAi.key || !activeAi.model || !aiSettings.resume) {
                showStatus('请先配置完整的 API 信息和你的简历！', 'error');
                return;
            }

            let apiUrlObj;
            try { apiUrlObj = new URL(activeAi.url); } catch (e) {
                showStatus('API URL 格式不正确', 'error');
                return;
            }
            const origin = `${apiUrlObj.protocol}//${apiUrlObj.host}/*`;
            const hasPermission = await new Promise(resolve => {
                chrome.permissions.contains({ origins: [origin] }, resolve);
            });
            if (!hasPermission) {
                const granted = await new Promise(resolve => {
                    chrome.permissions.request({ origins: [origin] }, (res) => {
                        if (chrome.runtime.lastError) console.warn(chrome.runtime.lastError);
                        resolve(res);
                    });
                });
                if (!granted) {
                    showStatus('需要授权才能进行批量诊断', 'error');
                    return;
                }
            }

            const jobsToScore = currentDisplayedJobs.filter(job => {
                const jobId = getJobId(job);
                return !aiScores[jobId];
            });

            if (jobsToScore.length === 0) {
                showStatus('当前列表中的职位都已完成 AI 评分', 'info');
                return;
            }

            const isConfirmed = confirm(`将在后台依次对这 ${jobsToScore.length} 个职位进行诊断，预计需要一些时间，是否继续？`);

            if (!isConfirmed) return;

            isBatchAiRunning = true;
            isBatchAiPaused = false;

            let successCount = 0;
            let failCount = 0;

            for (let i = 0; i < jobsToScore.length; i++) {
                while (isBatchAiPaused) {
                    await new Promise(r => setTimeout(r, 500));
                }

                const job = jobsToScore[i];
                btnBatchAiScore.textContent = `⏸ 暂停 (${i + 1}/${jobsToScore.length})`;

                const success = await scoreJobBackground(job, null);
                if (success) {
                    successCount++;
                } else {
                    failCount++;
                }

                // Add a small delay between requests to avoid rate limits
                if (i < jobsToScore.length - 1) {
                    await new Promise(r => setTimeout(r, 2000));
                }
            }

            isBatchAiRunning = false;
            isBatchAiPaused = false;
            btnBatchAiScore.textContent = '⚡ 批量 AI 诊断';

            alert(`批量诊断完成\n成功: ${successCount} 个, 失败: ${failCount} 个`);
        });
    }

    if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) {
            closeModal();
        }
    });


    // AI Generate Intro Event Listeners
    async function handleGenerateIntro() {
        if (!currentJob) return;
        const activeAi = getActiveAiProfile();
        if (!activeAi.url || !activeAi.key || !activeAi.model || !aiSettings.resume) {
            showStatus('请先配置 AI 信息和简历', 'error');
            return;
        }

        if (introductionEmpty) introductionEmpty.style.display = 'none';
        if (introductionContent) introductionContent.style.display = 'flex';
        if (introHeaderActions) introHeaderActions.style.display = 'none';
        if (introText) introText.innerHTML = '<span style="color:#666;">正在生成定制化打招呼语，请稍候...</span>';

        const jobDesc = currentJob['职位描述'] || '';
        const jobTitle = currentJob['职位名称'] || '';
        const company = currentJob['公司名称'] || '';
        const reqs = `薪资: ${currentJob['薪资待遇'] || ''}, 经验: ${currentJob['工作经验'] || ''}, 学历: ${currentJob['学历要求'] || ''}`;

        try {
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    action: 'aiGenerateIntro',
                    url: activeAi.url,
                    key: activeAi.key,
                    model: activeAi.model,
                    resume: aiSettings.resume,
                    company: company,
                    jobTitle: jobTitle,
                    reqs: reqs,
                    jobDesc: jobDesc
                }, (res) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else if (res && res.success) resolve(res);
                    else reject(new Error(res ? res.error : '未知错误'));
                });
            });
            const formattedIntro = response.resultText.replace(/\n/g, '<br>');
            if (introText) introText.innerHTML = formattedIntro;
            if (introHeaderActions) introHeaderActions.style.display = 'flex';

            const jobId = getJobId(currentJob);
            aiIntros[jobId] = formattedIntro;
            chrome.storage.local.set({ ai_job_intros: aiIntros });

        } catch (error) {
            if (introText) introText.innerHTML = `<span style="color:#FF3B30;">生成失败: ${error.message}</span>`;
        }
    }

    if (btnGenerateIntro) btnGenerateIntro.addEventListener('click', handleGenerateIntro);
    if (btnRegenerateIntro) btnRegenerateIntro.addEventListener('click', handleGenerateIntro);

    if (btnCopyIntro) {
        btnCopyIntro.addEventListener('click', () => {
            if (!introText) return;
            const textToCopy = introText.innerText;
            navigator.clipboard.writeText(textToCopy).then(() => {
                showStatus('打招呼语已复制到剪贴板', 'success');
            }).catch(err => {
                showStatus('复制失败，请手动复制', 'error');
            });
        });
    }

    function deleteJob(jobId) {
        if (currentSource === 'merged-data' || currentSource === 'dashboard-data') {
            showStatus('合并视图不支持直接删除单条数据，请前往源平台视图删除。', 'warning');
            return;
        }
        if (!jobId) return;

        if (confirm('确定要删除该职位吗？')) {
            allData = allData.filter(job => job['职位ID'] !== jobId);
            let storageKeys = ['boss_scraped_v2'];
            if (currentSource === '51job-data') storageKeys = ['51job_scraped_v2'];
            if (currentSource === 'liepin-data') storageKeys = ['liepin_scraped_data_v1'];
            if (currentSource === 'zhilian-data') storageKeys = ['zhilian_scraped_data_v1', 'zhilian_scraped_data_v2'];

            chrome.storage.local.get(storageKeys, (res) => {
                let currentAll = [];
                storageKeys.forEach(k => {
                    if (res[k]) currentAll = currentAll.concat(res[k].filter(j => (j.jobId || j.number || '') !== jobId));
                });
                chrome.storage.local.set({ [storageKeys[0]]: currentAll }, () => {
                    applyFilters();
                });
            });
        }
    }

    function getJobId(job) {
        return job['职位ID'] || job['干净链接'] || job['职位链接'] || `${job['职位名称']}-${job['公司名称']}`;
    }

    function applyFilters() {
        if (currentSource === 'dashboard-data') return;

        const kw = searchInput.value.trim().toLowerCase();
        const showFavOnly = filterFavoritesOnly && filterFavoritesOnly.checked;
        const showBlacklisted = filterShowBlacklisted && filterShowBlacklisted.checked;
        const filterShowHidden = document.getElementById('filter-show-hidden');
        const showHidden = filterShowHidden && filterShowHidden.checked;

        let filtered = allData;

        if (!showHidden) {
            filtered = filtered.filter(job => !job['是否隐藏']);
        }

        if (showFavOnly) {
            filtered = filtered.filter(job => favoritedJobs.includes(getJobId(job)));
        }

        if (!showBlacklisted) {
            filtered = filtered.filter(job => {
                const compName = job['公司名称'] || '';
                return !blacklistedCompanies.includes(compName);
            });
        }

        if (kw) {
            filtered = filtered.filter(job => {
                const name = (job['职位名称'] || '').toLowerCase();
                const comp = (job['公司名称'] || '').toLowerCase();
                return name.includes(kw) || comp.includes(kw);
            });
        }



        renderCards(filtered);
    }

    searchInput.addEventListener('input', applyFilters);
    if (filterFavoritesOnly) filterFavoritesOnly.addEventListener('change', applyFilters);
    filterShowBlacklisted.addEventListener('change', applyFilters);
    const filterShowHidden = document.getElementById('filter-show-hidden');
    if (filterShowHidden) filterShowHidden.addEventListener('change', applyFilters);

    // 不合适标签模态框逻辑
    let currentTaggingJobId = null;
    let currentSelectedTags = new Set();
    const tagModal = document.getElementById('tag-modal');
    const closeTagModalBtn = document.getElementById('close-tag-modal');
    const cancelTagBtn = document.getElementById('cancel-tag-btn');
    const saveTagBtn = document.getElementById('save-tag-btn');
    const predefinedTagBtns = document.querySelectorAll('.tag-btn');
    const customTagInput = document.getElementById('custom-tag-input');
    const selectedTagsContainer = document.getElementById('selected-tags-container');

    function openTagModal(jobId, job) {
        currentTaggingJobId = jobId;
        currentSelectedTags.clear();
        let existingInfo = window.userJobTags[jobId] || { tags: [], isHidden: false };
        if (existingInfo.tags) {
            existingInfo.tags.forEach(t => currentSelectedTags.add(t));
        }
        customTagInput.value = '';
        renderSelectedTags();
        tagModal.style.display = 'flex';
    }

    function renderSelectedTags() {
        selectedTagsContainer.innerHTML = '';
        currentSelectedTags.forEach(tag => {
            const span = document.createElement('span');
            span.style.cssText = 'background: #e0f2fe; color: #0284c7; padding: 4px 8px; border-radius: 4px; font-size: 12px; display: flex; align-items: center; gap: 6px;';
            span.innerHTML = `<span>${tag}</span><span style="cursor:pointer; font-weight:bold; color: #0284c7;">&times;</span>`;
            span.querySelector('span:last-child').addEventListener('click', () => {
                currentSelectedTags.delete(tag);
                renderSelectedTags();
            });
            selectedTagsContainer.appendChild(span);
        });
    }

    predefinedTagBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            currentSelectedTags.add(btn.textContent.trim());
            renderSelectedTags();
        });
    });

    customTagInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && customTagInput.value.trim()) {
            currentSelectedTags.add(customTagInput.value.trim());
            customTagInput.value = '';
            renderSelectedTags();
        }
    });

    function closeTagModal() {
        tagModal.style.display = 'none';
        currentTaggingJobId = null;
    }

    if (closeTagModalBtn) closeTagModalBtn.addEventListener('click', closeTagModal);
    if (cancelTagBtn) cancelTagBtn.addEventListener('click', closeTagModal);

    if (saveTagBtn) {
        saveTagBtn.addEventListener('click', () => {
            if (!currentTaggingJobId) return;
            const tags = Array.from(currentSelectedTags);

            // 存入 window.userJobTags
            window.userJobTags[currentTaggingJobId] = {
                tags: tags,
                isHidden: true,
                updateTime: new Date().toISOString()
            };

            // 同步修改 allData 里该职位的信息，使得 UI 立刻响应
            allData.forEach(job => {
                let id = getJobId(job);
                if (id === currentTaggingJobId) {
                    job['人工标签'] = tags;
                    job['是否隐藏'] = true;
                }
            });

            // 存入 chrome.storage
            chrome.storage.local.set({ user_job_tags: window.userJobTags }, () => {
                closeTagModal();
                showStatus('标记成功并已隐藏职位', 'success');
                applyFilters(); // 重新渲染列表
            });
        });
    }

    // 导出当前展示的数据 (受筛选影响)
    btnExportAll.addEventListener('click', () => {
        if (allData.length === 0) {
            showStatus('没有数据可导出', 'warning');
            return;
        }
        let prefix = 'BOSS直聘';
        if (currentSource === '51job-data') prefix = '51JOB';
        if (currentSource === 'liepin-data') prefix = '猎聘';
        if (currentSource === 'zhilian-data') prefix = '智联招聘';
        if (currentSource === 'merged-data' || currentSource === 'dashboard-data') prefix = '全网合并';
        exportToCSV(allData, prefix + '_全部数据');
    });

    // 一键同步到本地服务器
    const btnSyncData = document.getElementById('btn-sync-data');
    const syncModal = document.getElementById('sync-modal');
    const syncModalClose = document.getElementById('sync-modal-close');
    const btnSyncCancel = document.getElementById('btn-sync-cancel');
    const btnSyncConfirm = document.getElementById('btn-sync-confirm');
    const syncOptionsList = document.getElementById('sync-options-list');

    const allSyncKeys = [
        '51job_companies_scraped', '51job_scraped_v2', '51job_single_details',
        'ai_job_scores', 'ai_job_intros', 'ai_settings',
        'blacklisted_companies',
        'boss_companies_scraped', 'boss_company_details', 'boss_scraped_v2', 'boss_single_details',
        'favorited_jobs', 'interview_questions', 'job_interviews', 'job_statuses',
        'liepin_companies_db_v1', 'liepin_company_details', 'liepin_scraped_data_v1', 'liepin_single_details',
        'user_job_tags',
        'zhilian_company_cache', 'zhilian_enrichment_cache', 'zhilian_scraped_data_v1', 'zhilian_scraped_data_v2', 'zhilian_scraped_v2', 'zhilian_single_details'
    ];

    if (btnSyncData && syncModal) {
        btnSyncData.addEventListener('click', () => {
            syncOptionsList.innerHTML = '';
            allSyncKeys.forEach(key => {
                const label = document.createElement('label');
                label.style.display = 'flex';
                label.style.alignItems = 'center';
                label.style.padding = '8px 10px';
                label.style.background = '#f9f9fb';
                label.style.borderRadius = '6px';
                label.style.cursor = 'pointer';
                label.style.border = '1px solid #eee';
                label.style.fontSize = '13px';
                
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = key;
                checkbox.checked = true;
                checkbox.style.marginRight = '8px';
                
                const text = document.createElement('span');
                text.textContent = key;
                text.style.fontWeight = '500';
                text.style.wordBreak = 'break-all';
                
                label.appendChild(checkbox);
                label.appendChild(text);
                syncOptionsList.appendChild(label);
            });
            syncModal.classList.add('active');
        });

        const closeSyncModal = () => {
            syncModal.classList.remove('active');
        };

        syncModalClose.addEventListener('click', closeSyncModal);
        btnSyncCancel.addEventListener('click', closeSyncModal);

        btnSyncConfirm.addEventListener('click', () => {
            const selectedKeys = [];
            syncOptionsList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                if (cb.checked) {
                    selectedKeys.push(cb.value);
                }
            });

            if (selectedKeys.length === 0) {
                alert('请至少选择一个数据文件进行同步！');
                return;
            }

            const btnOriginalText = btnSyncConfirm.innerHTML;
            btnSyncConfirm.innerHTML = '同步中...';
            btnSyncConfirm.disabled = true;
            btnSyncData.innerHTML = '🚀 强力同步中...';
            btnSyncData.disabled = true;

            chrome.storage.local.get(selectedKeys, async (res) => {
                try {
                    const response = await fetch('http://localhost:3000/api/sync-all', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(res)
                    });

                    const result = await response.json();
                    if (result.success) {
                        if (result.changedJobs && result.changedJobs.length > 0) {
                            const sampleTitles = result.changedJobs.slice(0, 2).map(j => `【${j.companyName}】${j.title}`).join('、');
                            const more = result.changedJobs.length > 2 ? ` 等共 ${result.changedJobs.length} 个岗位` : '';
                            showStatus(`📢 发现 ${result.changedJobs.length} 个岗位变更！${sampleTitles}${more}（已更新指纹）`, 'warning');
                            console.log('[Job Monitor] 检测到以下岗位变更 (descHash/薪资):', result.changedJobs);
                        } else {
                            showStatus(result.message || '爬取数据同步成功！所有岗位内容指纹一致', 'success');
                        }
                        console.log('Sync Results:', result.results);
                        closeSyncModal();
                    } else {
                        throw new Error(result.error || result.message || '未知错误');
                    }
                } catch (err) {
                    console.error(err);
                    showStatus(`数据同步失败: ${err.message}`, 'error');
                } finally {
                    btnSyncConfirm.innerHTML = btnOriginalText;
                    btnSyncConfirm.disabled = false;
                    btnSyncData.innerHTML = '🚀 强力同步爬取数据';
                    btnSyncData.disabled = false;
                }
            });
        });
    }

    // 清除所有数据（一次性清除所有平台保存的数据：列表数据、详情数据、公司数据）
    btnClearAll.addEventListener('click', () => {
        const confirmMsg = '⚠️ 警告：您确定要清除所有平台保存的抓取数据吗？\n\n' +
            '此操作将一次性清除：\n' +
            '1. 所有平台（Boss直聘、智联招聘、前程无忧、猎聘）从职位列表页面抓取的数据；\n' +
            '2. 所有平台从职位详情页抓取的数据（含详情影子库与增强缓存）；\n' +
            '3. 所有平台从公司页面抓取的数据。\n\n' +
            '（注：您的个人设置、AI 配置、收藏与黑名单等数据将得到保留）\n\n' +
            '此操作不可逆，是否确认清除？';

        if (confirm(confirmMsg)) {
            const allPlatformStorageKeys = [
                // 1. 职位列表页面抓取的数据
                'boss_scraped_v2',
                '51job_scraped_v2',
                'liepin_scraped_data_v1',
                'zhilian_scraped_v2',
                'zhilian_scraped_data_v2',
                'zhilian_scraped_data_v1',
                // 2. 职位详情页面抓取的数据
                'boss_single_details',
                '51job_single_details',
                'liepin_single_details',
                'zhilian_single_details',
                'zhilian_enrichment_cache',
                // 3. 公司页面抓取的数据
                'boss_companies_scraped',
                'boss_company_details',
                '51job_companies_scraped',
                'liepin_companies_db_v1',
                'liepin_company_details',
                'zhilian_company_cache',
                // 4. 抓取任务运行时状态残留
                'liepin_auto_resume_v1',
                'isZhilianScraping',
                'is51jobScraping'
            ];

            chrome.storage.local.remove(allPlatformStorageKeys, (err) => {
                if (err) {
                    showStatus('清理失败：数据库处于锁定状态，请点击上方提示重载扩展', 'error');
                    return;
                }
                allData = [];
                window.zhilianEnrichmentCache = {};
                showStatus('所有平台保存的职位列表、详情及公司数据已成功清除！', 'success');
                loadData();
            });
        }
    });

    // 清空特定缓存
    document.querySelectorAll('.btn-clear-specific').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const key = e.target.getAttribute('data-key');
            if (confirm(`确定要清空文件【${key}】的数据吗？此操作不可逆！`)) {
                chrome.storage.local.remove(key, (err) => {
                    if (err) {
                        showStatus(`清空 ${key} 失败：数据库处于锁定状态，请点击上方提示重载扩展`, 'error');
                        return;
                    }
                    showStatus(`已清空 ${key}`, 'success');
                    loadData();
                });
            }
        });
    });

    // Boss 直聘同步详情
    const btnSyncBoss = document.getElementById('btn-sync-boss');
    if (btnSyncBoss) {
        btnSyncBoss.addEventListener('click', () => {
            chrome.storage.local.get(['boss_scraped_v2', 'boss_single_details'], (res) => {
                const listData = res.boss_scraped_v2 || [];
                const detailData = res.boss_single_details || [];

                if (detailData.length === 0) {
                    showStatus('影子库 (boss_single_details) 中没有数据，请先浏览职位详情页！', 'error');
                    return;
                }

                const detailMap = {};
                detailData.forEach(d => {
                    detailMap[d['职位ID']] = d;
                });

                let syncCount = 0;
                listData.forEach(row => {
                    const jobId = row.jobId || row.encryptJobId;
                    const d = detailMap[jobId];
                    if (d) {
                        if (!row.jobDetail) {
                            row.jobDetail = {};
                        }
                        row.jobDetail['公司全称'] = d['公司全称'];
                        row.jobDetail['页面更新时间'] = d['页面更新时间'];
                        row.jobDetail['最后刷新时间'] = d['最后刷新时间'];
                        row.jobDetail['精确更新时间'] = d['精确更新时间'];
                        row.jobDetail['招聘状态'] = d['招聘状态'];
                        row['_fetched_jobStatus'] = d['招聘状态'];
                        row['_fetched_updateTime'] = d['页面更新时间'];
                        row['_fetched_companyFullName'] = d['公司全称'];
                        syncCount++;
                    }
                });

                if (syncCount > 0) {
                    chrome.storage.local.set({ boss_scraped_v2: listData }, () => {
                        showStatus(`同步成功！共更新了 ${syncCount} 条列表数据。`, 'success');
                        if (currentSource === 'boss-data') {
                            loadData(); // 重新渲染列表数据以体现同步结果
                        }
                    });
                } else {
                    showStatus('没有找到可以同步的数据（可能是列表和详情页数据没有匹配的职位）。', 'warning');
                }
            });
        });
    }

    // 猎聘同步详情 (影子库 -> 列表)
    const btnSyncLiepin = document.getElementById('btn-sync-liepin');
    if (btnSyncLiepin) {
        btnSyncLiepin.addEventListener('click', () => {
            chrome.storage.local.get(['liepin_scraped_data_v1', 'liepin_single_details'], (res) => {
                const listData = res.liepin_scraped_data_v1 || [];
                const detailData = res.liepin_single_details || [];

                if (detailData.length === 0) {
                    showStatus('影子库 (liepin_single_details) 中没有数据，请先浏览职位详情页！', 'error');
                    return;
                }

                const detailMap = {};
                detailData.forEach(d => {
                    if (d['职位ID']) detailMap[d['职位ID']] = d;
                });

                let syncCount = 0;
                listData.forEach(row => {
                    const rawJob = row.job || row;
                    const jobId = rawJob.jobId || row['职位ID'];
                    const d = detailMap[jobId];
                    if (d) {
                        for (const key of Object.keys(d)) {
                            if (d[key] && d[key] !== '' && !row[key]) {
                                row[key] = d[key];
                            }
                        }
                        if (d['职位描述']) row['职位描述'] = d['职位描述'];
                        if (d['招聘状态']) row['招聘状态'] = d['招聘状态'];
                        if (d['HR活跃度']) row['HR活跃度'] = d['HR活跃度'];
                        if (d['页面更新时间']) row['页面更新时间'] = d['页面更新时间'];
                        if (d['最后刷新时间']) row['最后刷新时间'] = d['最后刷新时间'];
                        if (d['精确更新时间']) row['精确更新时间'] = d['精确更新时间'];
                        if (d['公司全称']) row['公司全称'] = d['公司全称'];
                        row.jobDetailJson = row.jobDetailJson || d.jobDetailJson || d.jobDetail;
                        syncCount++;
                    }
                });

                // 将仅在详情页抓取过的独立职位也追加进列表库
                let appendCount = 0;
                const existingIds = new Set(listData.map(j => (j.job && j.job.jobId) || j.jobId || j['职位ID']));
                detailData.forEach(d => {
                    if (d['职位ID'] && !existingIds.has(d['职位ID'])) {
                        listData.push(d);
                        existingIds.add(d['职位ID']);
                        appendCount++;
                    }
                });

                if (syncCount > 0 || appendCount > 0) {
                    chrome.storage.local.set({ liepin_scraped_data_v1: listData }, () => {
                        let msg = `同步成功！`;
                        if (syncCount > 0) msg += `更新了 ${syncCount} 条已有职位`;
                        if (appendCount > 0) msg += `，追加了 ${appendCount} 条单页抓取职位`;
                        showStatus(msg, 'success');
                        if (currentSource === 'liepin-data') {
                            loadData(); // 重新渲染列表数据以体现同步结果
                        }
                    });
                } else {
                    showStatus('没有找到可以同步的数据。', 'warning');
                }
            });
        });
    }

    // 51job 同步详情 (影子库 -> 列表)
    const btnSync51job = document.getElementById('btn-sync-51job');
    if (btnSync51job) {
        btnSync51job.addEventListener('click', () => {
            chrome.storage.local.get(['51job_scraped_v2', '51job_single_details'], (res) => {
                const listData = res['51job_scraped_v2'] || [];
                const detailData = res['51job_single_details'] || [];

                if (detailData.length === 0) {
                    showStatus('影子库 (51job_single_details) 中没有数据，请先浏览职位详情页！', 'error');
                    return;
                }

                const detailMap = {};
                detailData.forEach(d => {
                    if (d['职位ID']) detailMap[String(d['职位ID'])] = d;
                });

                let syncCount = 0;
                listData.forEach(row => {
                    const jId = String(row.jobId || row['职位ID'] || '');
                    const d = detailMap[jId];
                    if (d) {
                        for (const key of Object.keys(d)) {
                            if (d[key] && d[key] !== '' && !row[key]) {
                                row[key] = d[key];
                            }
                        }
                        if (d['公司全称']) row['公司全称'] = d['公司全称'];
                        if (d['详细完整地址']) row['详细完整地址'] = d['详细完整地址'];
                        if (d['企业资质标签']) row['企业资质标签'] = d['企业资质标签'];
                        syncCount++;
                    }
                });

                // 将仅在详情页抓取过的独立职位也追加进列表库
                let appendCount = 0;
                const existingIds = new Set(listData.map(j => String(j.jobId || j['职位ID'] || '')));
                detailData.forEach(d => {
                    if (d['职位ID'] && !existingIds.has(String(d['职位ID']))) {
                        listData.push(d);
                        existingIds.add(String(d['职位ID']));
                        appendCount++;
                    }
                });

                if (syncCount > 0 || appendCount > 0) {
                    chrome.storage.local.set({ '51job_scraped_v2': listData }, () => {
                        let msg = `同步成功！`;
                        if (syncCount > 0) msg += `更新了 ${syncCount} 条已有职位`;
                        if (appendCount > 0) msg += `，追加了 ${appendCount} 条单页抓取职位`;
                        showStatus(msg, 'success');
                        if (currentSource === '51job-data') {
                            loadData(); // 重新渲染列表数据以体现同步结果
                        }
                    });
                } else {
                    showStatus('没有找到可以同步的数据。', 'warning');
                }
            });
        });
    }

    function exportToCSV(data, prefix) {
        if (!data || !data.length) return;
        const headers = Object.keys(data[0]);
        let csv = '\uFEFF' + headers.join(',') + '\r\n';
        data.forEach(row => {
            csv += headers.map(h => {
                let v = row[h] == null ? '' : String(row[h]);
                return (v.includes(',') || v.includes('"') || v.includes('\n') || v.includes('\r')) ? `"${v.replace(/"/g, '""')}"` : v;
            }).join(',') + '\r\n';
        });
        const a = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })),
            download: `${prefix}_${Date.now()}.csv`
        });
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }

    // 监听 storage 变化（如果用户在别的页面抓取了新数据，这里自动更新）
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
            loadData();
        }
    });

    // 侧边栏导航逻辑
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            currentSource = item.getAttribute('data-target');

            if (currentSource === 'merged-data') {
                searchInput.placeholder = '在全网数据中搜索公司、职位...';
                searchInput.disabled = false;
            } else if (currentSource === 'dashboard-data') {
                searchInput.placeholder = '数据看板暂不支持搜索...';
                searchInput.disabled = true;
            } else {
                searchInput.placeholder = '搜索公司、职位或福利...';
                searchInput.disabled = false;
            }

            searchInput.value = '';
            if (filterFavoritesOnly) filterFavoritesOnly.checked = false;

            loadData();
        });
    });


    // 控制平台专属按钮显示/隐藏
    function updateActionButtons() {
        document.querySelectorAll('.btn-action-specific').forEach(btn => {
            if (btn.getAttribute('data-target') === currentSource) {
                btn.style.display = 'inline-block';
            } else {
                btn.style.display = 'none';
            }
        });
    }

    // 绑定平台专属导出按钮
    const exportIds = {
        'btn-export-boss': { key: 'boss_scraped_v2', prefix: 'BOSS直聘' },
        'btn-export-zhilian': { key: 'zhilian_scraped_data_v1', prefix: '智联招聘' },
        'btn-export-51job': { key: '51job_scraped_v2', prefix: '51JOB' },
        'btn-export-liepin': { key: 'liepin_scraped_data_v1', prefix: '猎聘' },
        'btn-export-merged': { key: 'merged', prefix: '全网合并' }
    };

    for (const [id, config] of Object.entries(exportIds)) {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('click', () => {
                if (config.key === 'merged') {
                    if (allData.length > 0) exportToCSV(allData, config.prefix + '_全部数据');
                    else showStatus('没有数据可导出', 'warning');
                } else if (config.key === 'liepin_scraped_data_v1') {
                    chrome.storage.local.get(['liepin_scraped_data_v1', 'liepin_single_details'], (res) => {
                        let rawData = [...(res['liepin_scraped_data_v1'] || [])];
                        if (res.liepin_single_details && Array.isArray(res.liepin_single_details)) {
                            const detailsDict = {};
                            res.liepin_single_details.forEach(d => { if (d['职位ID']) detailsDict[d['职位ID']] = d; });
                            rawData.forEach(job => {
                                const jId = (job.job && job.job.jobId) || job.jobId || job['职位ID'];
                                const detail = detailsDict[jId];
                                if (detail) {
                                    for (const key of Object.keys(detail)) {
                                        if (detail[key] && detail[key] !== '' && !job[key]) {
                                            job[key] = detail[key];
                                        }
                                    }
                                }
                            });
                            const existingLpIds = new Set(rawData.map(j => (j.job && j.job.jobId) || j.jobId || j['职位ID']));
                            const standaloneLp = res.liepin_single_details.filter(d => d['职位ID'] && !existingLpIds.has(d['职位ID']));
                            rawData = [...rawData, ...standaloneLp];
                        }
                        if (rawData.length === 0) {
                            showStatus('没有数据可导出', 'warning');
                            return;
                        }
                        const normalizedData = rawData.map(job => normalizeJob(job, 'liepin'));
                        exportToCSV(normalizedData, config.prefix + '_全部数据');
                    });
                } else {
                    chrome.storage.local.get([config.key], (res) => {
                        const rawData = res[config.key] || [];
                        if (rawData.length === 0) {
                            showStatus('没有数据可导出', 'warning');
                            return;
                        }
                        const normalizedSource = config.key.split('_')[0];
                        const normalizedData = rawData.map(job => normalizeJob(job, normalizedSource));
                        exportToCSV(normalizedData, config.prefix + '_全部数据');
                    });
                }
            });
        }
    }

    // 绑定专属清空按钮
    document.querySelectorAll('.btn-clear-specific').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.getAttribute('data-key');
            if (confirm(`确定要清空 ${key} 的缓存数据吗？`)) {
                chrome.storage.local.remove(key, () => {
                    showStatus(`已清空 ${key} 缓存`, 'success');
                    loadData();
                });
            }
        });
    });

    chrome.storage.local.get(['blacklisted_companies', 'favorited_jobs', 'ai_settings', 'job_statuses', 'job_interviews', 'ai_job_scores', 'interview_questions', 'ai_job_intros', 'auto_sync_enabled'], (res) => {
        blacklistedCompanies = res.blacklisted_companies || [];
        favoritedJobs = res.favorited_jobs || [];
        jobStatuses = res.job_statuses || {};
        jobInterviews = res.job_interviews || {};
        aiScores = res.ai_job_scores || {};
        aiIntros = res.ai_job_intros || {};
        questionBank = res.interview_questions || [];
        if (res.ai_settings) {
            if (res.ai_settings.url !== undefined && !res.ai_settings.profiles) {
                // Migration from old format
                aiSettings = {
                    activeProfileId: 'default',
                    profiles: [{
                        id: 'default',
                        name: '默认配置',
                        url: res.ai_settings.url || '',
                        key: res.ai_settings.key || '',
                        model: res.ai_settings.model || ''
                    }],
                    resume: res.ai_settings.resume || ''
                };
                chrome.storage.local.set({ ai_settings: aiSettings });
            } else {
                aiSettings = res.ai_settings;
            }
        }
        if (aiResume) aiResume.value = aiSettings.resume || '';
        renderAiProfiles();

        // 清空浏览器可能缓存的筛选输入，避免初始加载时数据被错误过滤为空
        if (searchInput) searchInput.value = '';
        if (filterFavoritesOnly) filterFavoritesOnly.checked = false;

        if (autoSyncCheckbox) {
            autoSyncCheckbox.checked = res.auto_sync_enabled === true;
            autoSyncCheckbox.addEventListener('change', (e) => {
                chrome.storage.local.set({ auto_sync_enabled: e.target.checked });
            });
        }

        const activeNav = document.querySelector('.sidebar .nav li.active');
        if (activeNav) {
            activeNav.click();
        } else {
            loadData();
        }
    });

    // ----------------------------------------------------
    // 面试日历与复盘功能
    // ----------------------------------------------------
    function openInterviewModal(job) {
        if (!job) return;
        currentInterviewJob = job;
        const jobId = getJobId(job);

        interviewJobTitle.textContent = job['职位名称'] + ' - ' + job['公司名称'];
        interviewRawText.value = '';
        interviewStartTime.value = '';
        interviewEndTime.value = '';
        interviewLocation.value = '';
        interviewNotes.value = '';
        interviewDebrief.value = '';
        interviewAiLoading.style.display = 'none';

        // Load existing interview data if any
        const existingData = jobInterviews[jobId];
        if (existingData) {
            interviewStartTime.value = existingData.startTime || '';
            interviewEndTime.value = existingData.endTime || '';
            interviewLocation.value = existingData.location || '';
            interviewNotes.value = existingData.notes || '';
            interviewDebrief.value = existingData.debrief || '';
        }

        interviewModal.style.display = 'flex';
    }

    interviewModalCloseBtn.addEventListener('click', () => {
        interviewModal.style.display = 'none';
        currentInterviewJob = null;
    });

    btnAiParseInterview.addEventListener('click', async () => {
        const text = interviewRawText.value.trim();
        if (!text) {
            showStatus('请先粘贴面试邀请内容！', 'warning');
            return;
        }

        const activeAi = getActiveAiProfile();
        if (!activeAi.url || !activeAi.key || !activeAi.model) {
            showStatus('请先在"AI 诊断设置"中配置 API 信息', 'error');
            return;
        }

        interviewAiLoading.style.display = 'block';
        btnAiParseInterview.disabled = true;

        const prompt = `请从以下面试邀请文本中提取结构化信息：
1. 面试开始时间（请转换为本地时区的YYYY-MM-DDTHH:mm格式）
2. 面试结束时间（如果没有明确说明，请默认在开始时间后加1小时，格式同上）
3. 面试地点或会议链接
4. 面试官姓名及其他备注事项

请严格返回以下格式的 JSON，不要包含任何其他文字：
{
  "startTime": "2023-10-25T14:00",
  "endTime": "2023-10-25T15:00",
  "location": "腾讯会议 123-456",
  "notes": "面试官：张三"
}

面试邀请内容：
${text}
`;
        try {
            let finalUrl = activeAi.url.trim();
            const isClaude = activeAi.model.toLowerCase().includes('claude') || finalUrl.includes('anthropic');
            const isGemini = activeAi.model.toLowerCase().includes('gemini');
            let headers = { 'Content-Type': 'application/json' };
            let body = {};

            if (isClaude && !finalUrl.includes('chat/completions')) {
                headers['x-api-key'] = activeAi.key;
                headers['anthropic-version'] = '2023-06-01';
                body = {
                    model: activeAi.model,
                    max_tokens: 1500,
                    messages: [{ role: 'user', content: prompt }]
                };
            } else if (isGemini && !finalUrl.includes('chat/completions')) {
                if (!finalUrl.includes(':generateContent')) {
                    finalUrl = finalUrl.replace(/\/$/, '') + `/v1beta/models/${activeAi.model}:generateContent`;
                }
                headers['x-goog-api-key'] = activeAi.key;
                body = {
                    contents: [{ role: 'user', parts: [{ text: prompt }] }]
                };
            } else {
                headers['Authorization'] = `Bearer ${activeAi.key}`;
                body = {
                    model: activeAi.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.1
                };
            }

            const response = await fetch(finalUrl, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(body)
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();

            let resultText = '';
            if (isClaude && !finalUrl.includes('chat/completions')) {
                resultText = (data.content && data.content[0] && data.content[0].text) || '';
            } else if (isGemini && !finalUrl.includes('chat/completions')) {
                resultText = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text) || '';
            } else {
                resultText = (data.choices && data.choices[0] && data.choices[0].message.content) || '';
            }

            // Clean markdown json block if any
            resultText = resultText.replace(/^```json/m, '').replace(/^```/m, '').trim();
            const parsed = JSON.parse(resultText);

            if (parsed.startTime) interviewStartTime.value = parsed.startTime;
            if (parsed.endTime) interviewEndTime.value = parsed.endTime;
            if (parsed.location) interviewLocation.value = parsed.location;
            if (parsed.notes) interviewNotes.value = parsed.notes;

        } catch (error) {
            console.error('AI 解析失败', error);
            showStatus('AI 解析失败，请检查配置或手动填写。', 'error');
        } finally {
            interviewAiLoading.style.display = 'none';
            btnAiParseInterview.disabled = false;
        }
    });

    btnSaveInterview.addEventListener('click', () => {
        if (!currentInterviewJob) return;
        const jobId = getJobId(currentInterviewJob);

        jobInterviews[jobId] = {
            startTime: interviewStartTime.value,
            endTime: interviewEndTime.value,
            location: interviewLocation.value,
            notes: interviewNotes.value,
            debrief: interviewDebrief.value,
            updatedAt: new Date().toISOString()
        };

        chrome.storage.local.set({ job_interviews: jobInterviews }, () => {
            showStatus('面试记录已保存！', 'success');
            interviewModal.style.display = 'none';
        });
    });

    // 生成并下载 ICS 文件
    btnExportIcs.addEventListener('click', () => {
        if (!currentInterviewJob) return;

        const start = interviewStartTime.value;
        const end = interviewEndTime.value;
        const location = interviewLocation.value;
        const notes = interviewNotes.value;

        if (!start || !end) {
            showStatus('请先填写开始和结束时间！', 'warning');
            return;
        }

        const formatIcsDate = (dateStr) => {
            const d = new Date(dateStr);
            return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        };

        const jobName = currentInterviewJob['职位名称'] || '';
        const companyName = currentInterviewJob['公司名称'] || '';
        const summary = `面试: ${companyName} - ${jobName}`;
        const description = notes || '无备注';

        const icsContent = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Job Scraper//Interview Calendar//EN',
            'BEGIN:VEVENT',
            `UID:${new Date().getTime()}@jobscraper`,
            `DTSTAMP:${formatIcsDate(new Date())}`,
            `DTSTART:${formatIcsDate(start)}`,
            `DTEND:${formatIcsDate(end)}`,
            `SUMMARY:${summary}`,
            `DESCRIPTION:${description}`,
            `LOCATION:${location}`,
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\\r\\n');

        const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `interview_${companyName}_${jobName}.ics`.replace(/\\s+/g, '_');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // --- 题库管理逻辑 (Question Bank) ---
    const qbContainer = document.getElementById('question-bank-container');
    const qbTableContainer = document.getElementById('qb-table-container');
    const qbListBody = document.getElementById('qb-list-body');
    const qbEmptyState = document.getElementById('qb-empty-state');
    const btnAddQuestion = document.getElementById('btn-add-question');
    const btnClearQuestionBank = document.getElementById('btn-clear-question-bank');
    const btnImportExcel = document.getElementById('btn-import-excel');
    const qbImportExcel = document.getElementById('qb-import-excel');
    const qbSearchInput = document.getElementById('qb-search-input');

    const qbModal = document.getElementById('qb-modal');
    const qbModalClose = document.getElementById('qb-modal-close');
    const qbModalTitle = document.getElementById('qb-modal-title');
    const qbInputTitle = document.getElementById('qb-input-title');
    const qbInputSerial = document.getElementById('qb-input-serial');
    const qbInputTheme = document.getElementById('qb-input-theme');
    const qbInputSub = document.getElementById('qb-input-sub');
    const qbInputTags = document.getElementById('qb-input-tags');
    const qbInputAnswer = document.getElementById('qb-input-answer');
    const btnQbDelete = document.getElementById('btn-qb-delete');
    const btnQbCancel = document.getElementById('btn-qb-cancel');
    const btnQbSave = document.getElementById('btn-qb-save');
    const btnQbAiAnswer = document.getElementById('btn-qb-ai-answer');

    let currentEditingQuestionId = null;

    function renderQuestionBank() {
        if (!qbTableContainer || !qbListBody || !qbEmptyState) return;
        const query = (qbSearchInput.value || '').toLowerCase().trim();
        const filtered = questionBank.filter(q => {
            return (q.title && q.title.toLowerCase().includes(query)) ||
                (q.themeCategory && q.themeCategory.toLowerCase().includes(query)) ||
                (q.subCategory && q.subCategory.toLowerCase().includes(query)) ||
                (q.tags && q.tags.toLowerCase().includes(query));
        });

        qbListBody.innerHTML = '';
        if (filtered.length === 0) {
            qbTableContainer.style.display = 'none';
            qbEmptyState.style.display = 'block';
        } else {
            qbTableContainer.style.display = 'block';
            qbEmptyState.style.display = 'none';

            filtered.sort((a, b) => b.createdAt - a.createdAt).forEach(q => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid #eee';
                tr.style.transition = 'background 0.2s';
                tr.style.cursor = 'pointer';
                tr.onmouseover = () => { tr.style.background = '#f5f7fa'; };
                tr.onmouseout = () => { tr.style.background = 'transparent'; };

                let tagsHtml = '';
                if (q.tags) {
                    tagsHtml = q.tags.split(',').map(t => t.trim()).filter(t => t).map(t => `<span style="background: #eef2f5; color: #555; font-size: 12px; padding: 2px 6px; border-radius: 4px; display: inline-block; margin: 2px;">${t}</span>`).join('');
                }

                tr.innerHTML = `
                    <td style="padding: 12px 16px; color: #888;">${q.serialNo || '-'}</td>
                    <td style="padding: 12px 16px; font-weight: 500; color: #333;">${q.title || '无题干'}</td>
                    <td style="padding: 12px 16px; color: #555;">${q.themeCategory || '-'}</td>
                    <td style="padding: 12px 16px; color: #555;">${q.subCategory || '-'}</td>
                    <td style="padding: 12px 16px;">${tagsHtml || '-'}</td>
                    <td style="padding: 12px 16px;">
                        <button class="btn-edit-q" style="background: transparent; border: 1px solid #007bff; border-radius: 4px; color: #007bff; cursor: pointer; padding: 4px 10px; font-size: 12px;">编辑</button>
                    </td>
                `;

                tr.addEventListener('click', () => openQuestionModal(q));

                qbListBody.appendChild(tr);
            });
        }
    }

    function openQuestionModal(q = null) {
        if (!qbModal) return;
        if (q) {
            currentEditingQuestionId = q.id;
            qbModalTitle.textContent = '编辑题目';
            qbInputTitle.value = q.title || '';
            qbInputSerial.value = q.serialNo || '';
            qbInputTheme.value = q.themeCategory || '';
            qbInputSub.value = q.subCategory || '';
            qbInputTags.value = q.tags || '';
            qbInputAnswer.value = q.answer || '';
            btnQbDelete.style.display = 'block';
        } else {
            currentEditingQuestionId = null;
            qbModalTitle.textContent = '新增题目';
            qbInputTitle.value = '';
            qbInputSerial.value = '';
            qbInputTheme.value = '';
            qbInputSub.value = '';
            qbInputTags.value = '';
            qbInputAnswer.value = '';
            btnQbDelete.style.display = 'none';
        }
        qbModal.style.display = 'flex';
    }

    function closeQuestionModal() {
        if (qbModal) qbModal.style.display = 'none';
    }

    if (btnAddQuestion) btnAddQuestion.addEventListener('click', () => openQuestionModal());

    if (btnClearQuestionBank) {
        btnClearQuestionBank.addEventListener('click', () => {
            if (questionBank.length === 0) {
                showStatus('题库已经是空的了', 'info');
                return;
            }
            if (confirm(`警告：这将会清空所有的题库数据（共 ${questionBank.length} 条），此操作不可逆！\n\n确定要清空题库吗？`)) {
                questionBank = [];
                chrome.storage.local.set({ interview_questions: [] }, () => {
                    showStatus('题库已清空', 'success');
                    renderQuestionBank();
                });
            }
        });
    }

    if (btnImportExcel) {
        btnImportExcel.addEventListener('click', () => {
            if (qbImportExcel) qbImportExcel.click();
        });
    }

    if (qbImportExcel) {
        qbImportExcel.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (evt) => {
                try {
                    const data = new Uint8Array(evt.target.result);
                    // Use XLSX object from sheetjs
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];
                    const json = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

                    let importedCount = 0;
                    json.forEach(row => {
                        let title = '', answer = '', themeCategory = '', subCategory = '', tags = '', serialNo = '';

                        // Fuzzy matching for keys
                        for (let key of Object.keys(row)) {
                            const k = key.trim().toLowerCase();
                            const val = String(row[key]).trim();
                            if (!val) continue;

                            if (['序号', '编号', 'id', 'no', 'serial'].includes(k) && !serialNo) {
                                serialNo = val;
                            } else if (['面试题目', '题目', '题干', '问题', 'question', 'title'].includes(k) && !title) {
                                title = val;
                            } else if (['答案', '解析', 'answer', 'desc'].includes(k) && !answer) {
                                answer = val;
                            } else if (['主题分类', 'theme'].includes(k) && !themeCategory) {
                                themeCategory = val;
                            } else if (['二级分类', 'sub'].includes(k) && !subCategory) {
                                subCategory = val;
                            } else if (['标签', '分类', 'tags', 'category', 'type'].includes(k) && !tags) {
                                tags = val;
                            }
                        }

                        if (title) {
                            questionBank.push({
                                id: 'qb_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
                                serialNo: serialNo,
                                title: title,
                                answer: answer,
                                themeCategory: themeCategory,
                                subCategory: subCategory,
                                tags: tags,
                                createdAt: Date.now(),
                                updatedAt: Date.now()
                            });
                            importedCount++;
                        }
                    });

                    if (importedCount > 0) {
                        chrome.storage.local.set({ interview_questions: questionBank }, () => {
                            showStatus(`成功导入 ${importedCount} 道题目`, 'success');
                            renderQuestionBank();
                        });
                    } else {
                        showStatus('未找到有效的题目数据，请检查表头名称。', 'warning');
                    }
                } catch (error) {
                    console.error("Excel import error:", error);
                    showStatus('解析 Excel 文件失败，请确保格式正确。', 'error');
                } finally {
                    qbImportExcel.value = ''; // Reset file input
                }
            };
            reader.readAsArrayBuffer(file);
        });
    }

    if (qbModalClose) qbModalClose.addEventListener('click', closeQuestionModal);
    if (btnQbCancel) btnQbCancel.addEventListener('click', closeQuestionModal);

    if (qbSearchInput) {
        qbSearchInput.addEventListener('input', renderQuestionBank);
    }

    if (btnQbSave) {
        btnQbSave.addEventListener('click', () => {
            const title = qbInputTitle.value.trim();
            if (!title) {
                showStatus('题干不能为空', 'error');
                return;
            }
            const qData = {
                serialNo: qbInputSerial.value.trim(),
                title: title,
                themeCategory: qbInputTheme.value.trim(),
                subCategory: qbInputSub.value.trim(),
                tags: qbInputTags.value.trim(),
                answer: qbInputAnswer.value.trim()
            };

            if (currentEditingQuestionId) {
                const idx = questionBank.findIndex(q => q.id === currentEditingQuestionId);
                if (idx > -1) {
                    questionBank[idx] = { ...questionBank[idx], ...qData, updatedAt: Date.now() };
                }
            } else {
                questionBank.push({
                    id: 'qb_' + Date.now(),
                    ...qData,
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                });
            }

            chrome.storage.local.set({ interview_questions: questionBank }, () => {
                showStatus('题目保存成功', 'success');
                renderQuestionBank();
                closeQuestionModal();
            });
        });
    }

    if (btnQbDelete) {
        btnQbDelete.addEventListener('click', () => {
            if (confirm('确定要删除这道题目吗？')) {
                questionBank = questionBank.filter(q => q.id !== currentEditingQuestionId);
                chrome.storage.local.set({ interview_questions: questionBank }, () => {
                    showStatus('题目已删除', 'success');
                    renderQuestionBank();
                    closeQuestionModal();
                });
            }
        });
    }

    if (btnQbAiAnswer) {
        btnQbAiAnswer.addEventListener('click', () => {
            const title = qbInputTitle.value.trim();
            if (!title) {
                showStatus('请先输入题干', 'warning');
                return;
            }
            const activeAi = getActiveAiProfile();
            if (!activeAi.url || !activeAi.key || !activeAi.model) {
                showStatus('请先在"大模型配置"中设置 API 信息', 'error');
                return;
            }

            const btnOriginalText = btnQbAiAnswer.textContent;
            btnQbAiAnswer.textContent = '生成中...';
            btnQbAiAnswer.disabled = true;

            chrome.runtime.sendMessage({
                action: 'aiAnswerQuestion',
                url: activeAi.url,
                key: activeAi.key,
                model: activeAi.model,
                questionTitle: title,
                resume: aiSettings.resume
            }, (response) => {
                btnQbAiAnswer.textContent = btnOriginalText;
                btnQbAiAnswer.disabled = false;

                if (chrome.runtime.lastError) {
                    showStatus('调用AI失败: ' + chrome.runtime.lastError.message, 'error');
                } else if (response && response.success) {
                    qbInputAnswer.value = response.resultText;
                    showStatus('生成成功', 'success');
                } else {
                    showStatus('生成失败: ' + (response ? response.error : '未知错误'), 'error');
                }
            });
        });
    }

    // Expose openModal to Vue
    window.openJobDetailModal = openModal;

    window.renderCompanyCentricView = function (jobs, companyDatabases) {
        // 1. Group by Company
        const companiesMap = new Map();
        jobs.forEach(job => {
            let compName = job['公司全称'] || job['公司名称'] || '未知公司';
            if (compName === '未知公司') return;

            if (!companiesMap.has(compName)) {
                // Find company info from databases
                const cBoss = companyDatabases.boss.find(c => c['公司全称'] === compName || c['公司名称'] === compName) || {};
                const c51job = companyDatabases['51job'].find(c => c['公司全称'] === compName || c['公司名称'] === compName) || {};
                const cLiepin = companyDatabases.liepin.find(c => c['公司全称'] === compName || c['公司名称'] === compName) || {};
                const cZhilian = companyDatabases.zhilian.find(c => c['公司名称'] === compName) || {};

                const bestCompanyInfo = cBoss['公司全称'] ? cBoss : (c51job['公司全称'] ? c51job : (cLiepin['公司全称'] ? cLiepin : cZhilian));

                companiesMap.set(compName, {
                    companyName: compName,
                    companyInfo: {
                        scale: bestCompanyInfo['公司规模'] || bestCompanyInfo.companySize || bestCompanyInfo.size || '',
                        type: bestCompanyInfo['企业类型'] || bestCompanyInfo.companyType || bestCompanyInfo.property || ''
                    },
                    platformSources: new Set(),
                    jobs: []
                });
            }

            const cNode = companiesMap.get(compName);
            if (job['平台']) {
                cNode.platformSources.add(job['平台']);
            }

            let tags = job['技能标签'] || '';
            if (typeof tags === 'string') {
                tags = tags.split(',').filter(t => t.trim()).slice(0, 3);
            } else if (Array.isArray(tags)) {
                tags = tags.slice(0, 3);
            }

            cNode.jobs.push({
                id: job['职位ID'] || Math.random().toString(),
                title: job['职位名称'] || '未知职位',
                salary: job['薪资待遇'] || '面议',
                location: job['工作地点'] || '未知',
                experience: job['工作经验'] || '不限',
                degree: job['学历要求'] || '不限',
                tags: tags,
                updateTime: job['页面更新时间'] || job['发布日期'] || '未知',
                rawJob: job
            });
        });

        let companyArray = Array.from(companiesMap.values()).map(c => ({
            ...c,
            platformSources: Array.from(c.platformSources)
        })).sort((a, b) => b.jobs.length - a.jobs.length);

        const searchInput = document.getElementById('company-search-input');
        const emptyState = document.getElementById('company-empty-state');
        const accordion = document.getElementById('company-accordion');

        function getPlatformType(plat) {
            if (plat.includes('Boss')) return 'success';
            if (plat.includes('51job')) return 'warning';
            if (plat.includes('猎聘')) return 'danger';
            if (plat.includes('智联')) return 'primary';
            return 'info';
        }

        function createTag(text, type = 'info', isDark = false) {
            const span = document.createElement('span');
            span.className = `native-tag ${type} ${isDark ? 'dark' : ''}`;
            span.textContent = text;
            return span;
        }

        function renderAccordion(companies) {
            const tc = document.getElementById('total-count');
            const tl = document.getElementById('total-label');
            if (tc) tc.textContent = companies ? companies.length : 0;
            if (tl) tl.textContent = '家公司';

            accordion.innerHTML = '';
            if (companies.length === 0) {
                accordion.style.display = 'none';
                emptyState.style.display = 'block';
                return;
            }
            accordion.style.display = 'block';
            emptyState.style.display = 'none';

            companies.forEach((company, index) => {
                const item = document.createElement('div');
                item.className = 'native-collapse-item';
                if (index < 5) item.classList.add('is-active'); // Open first 5 by default

                // Header
                const header = document.createElement('div');
                header.className = 'native-collapse-header';

                const arrow = document.createElement('div');
                arrow.className = 'native-collapse-arrow';
                arrow.innerHTML = `<svg width="12" height="12" viewBox="0 0 1024 1024"><path fill="currentColor" d="M340.864 149.312a30.592 30.592 0 0 0 0 42.752L652.736 512L340.864 831.872a30.592 30.592 0 0 0 0 42.752 29.12 29.12 0 0 0 41.728 0L714.24 533.376a32 32 0 0 0 0-42.752L382.592 149.312a29.12 29.12 0 0 0-41.728 0z"></path></svg>`;

                const headerInfo = document.createElement('div');
                headerInfo.className = 'company-header-info';

                const titleSpan = document.createElement('span');
                titleSpan.style = 'font-size: 16px; color: #1e293b; font-weight: bold;';
                titleSpan.textContent = company.companyName;
                headerInfo.appendChild(titleSpan);

                if (company.companyInfo.scale) headerInfo.appendChild(createTag(company.companyInfo.scale, 'info'));
                if (company.companyInfo.type) headerInfo.appendChild(createTag(company.companyInfo.type, 'info'));
                headerInfo.appendChild(createTag(`共 ${company.jobs.length} 个职位`, 'success'));

                const platsDiv = document.createElement('div');
                platsDiv.style = 'margin-left: auto; display: flex; gap: 5px; padding-right: 15px;';
                company.platformSources.forEach(plat => {
                    platsDiv.appendChild(createTag(plat, getPlatformType(plat), true));
                });
                headerInfo.appendChild(platsDiv);

                header.appendChild(arrow);
                header.appendChild(headerInfo);

                header.addEventListener('click', () => {
                    item.classList.toggle('is-active');
                });

                // Content
                const content = document.createElement('div');
                content.className = 'native-collapse-content';

                const grid = document.createElement('div');
                grid.className = 'job-card-grid';
                grid.style = 'padding: 15px; background: #f8f9fa; border-radius: 8px;';

                company.jobs.forEach(job => {
                    const card = document.createElement('div');
                    card.className = 'card';
                    card.style = 'margin: 0; min-height: unset;';

                    const tagsHtml = (job.tags || []).map(t => `<span class="card-tag">${t}</span>`).join('');

                    card.innerHTML = `
                        <div class="card-header" style="padding-bottom: 5px;">
                            <h3 class="card-title" title="${job.title}">${job.title}</h3>
                            <span class="card-salary">${job.salary}</span>
                        </div>
                        <div class="card-info" style="font-size: 13px; color: #64748b; margin-bottom: 8px;">
                            ${job.location || ''} | ${job.experience || ''} | ${job.degree || ''}
                        </div>
                        <div class="card-tags" style="margin-bottom: 8px;">
                            ${tagsHtml}
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: auto; padding-top: 10px; border-top: 1px solid #f1f5f9;">
                            <span style="font-size: 12px; color: #94a3b8; display: flex; align-items: center; gap: 4px;">
                                <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                ${job.updateTime || ''}
                            </span>
                        </div>
                    `;

                    const btnDiv = card.querySelector('div:last-child');
                    const detailBtn = document.createElement('button');
                    detailBtn.className = 'action-btn primary-btn';
                    detailBtn.style = 'padding: 4px 10px; font-size: 12px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer;';
                    detailBtn.textContent = '查看详情';
                    detailBtn.onclick = () => window.openJobDetailModal(job.rawJob || job);
                    btnDiv.appendChild(detailBtn);

                    grid.appendChild(card);
                });

                content.appendChild(grid);
                item.appendChild(header);
                item.appendChild(content);
                accordion.appendChild(item);
            });
        }

        renderAccordion(companyArray);

        searchInput.oninput = (e) => {
            const query = e.target.value.toLowerCase().trim();
            if (!query) {
                renderAccordion(companyArray);
                return;
            }
            const filtered = companyArray.filter(c => c.companyName.toLowerCase().includes(query));
            renderAccordion(filtered);
        };
    }
});
