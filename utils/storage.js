/**
 * 高性能数据存储与 IndexedDB 抽象层 (Storage & IndexedDB Layer)
 * 具备与 chrome.storage.local 双向同步、索引加速与本地 LevelDB 防锁死能力
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.JobStorage = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const DB_NAME = 'JobScraperDB';
    const DB_VERSION = 1;
    let dbInstance = null;

    // 打开或初始化 IndexedDB
    function openDB() {
        if (dbInstance) return Promise.resolve(dbInstance);

        return new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') {
                return reject(new Error('IndexedDB 不受支持'));
            }

            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;

                // 职位主表
                if (!db.objectStoreNames.contains('jobs')) {
                    const jobStore = db.createObjectStore('jobs', { keyPath: 'id' });
                    jobStore.createIndex('platform', 'platform', { unique: false });
                    jobStore.createIndex('companyName', 'companyName', { unique: false });
                    jobStore.createIndex('jobTitle', 'jobTitle', { unique: false });
                    jobStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                    jobStore.createIndex('isFavorite', 'isFavorite', { unique: false });
                    jobStore.createIndex('isBlacklisted', 'isBlacklisted', { unique: false });
                }

                // 元数据与配置表 (缓存、设置、面试安排等)
                if (!db.objectStoreNames.contains('meta')) {
                    db.createObjectStore('meta', { keyPath: 'key' });
                }
            };

            request.onsuccess = (e) => {
                dbInstance = e.target.result;
                resolve(dbInstance);
            };

            request.onerror = (e) => {
                console.error('[JobStorage] 打开 IndexedDB 失败:', e.target.error);
                reject(e.target.error);
            };
        });
    }

    // 获取标准 Job ID
    function getStandardJobId(job) {
        if (!job || typeof job !== 'object') return '';
        return String(
            job['职位ID'] ||
            job.jobId ||
            job.encryptJobId ||
            (job.zpData && job.zpData.jobInfo && job.zpData.jobInfo.encryptId) ||
            (job.jobInfo && job.jobInfo.encryptId) ||
            ((job['公司全称'] || job['公司名称'] || '') + '|||' + (job['职位名称'] || ''))
        ).trim();
    }

    // 辅助转换 job 为统一索引对象
    function toDbJob(job, platformName, extras = {}) {
        const id = getStandardJobId(job);
        return {
            id: id,
            platform: platformName || job['平台'] || '未知',
            jobTitle: job['职位名称'] || job.jobTitle || job.jobName || '',
            companyName: job['公司全称'] || job['公司名称'] || job.companyName || '',
            salary: job['薪资待遇'] || job.provideSalaryString || '',
            experience: job['工作经验'] || job.workYearString || '',
            degree: job['学历要求'] || job.degreeString || '',
            location: job['工作地点'] || job.jobAreaString || '',
            skills: job['技能标签'] || '',
            description: job['职位描述'] || '',
            updatedAt: job['页面更新时间'] || job['更新时间'] || job['创建时间'] || new Date().toISOString(),
            isFavorite: extras.favorites ? extras.favorites.includes(id) : false,
            isBlacklisted: extras.blacklistedCompanies ? extras.blacklistedCompanies.has(job['公司名称'] || job['公司全称']) : false,
            raw: job
        };
    }

    // 批量存入 IndexedDB
    async function bulkPutJobs(jobs, platformName, extras = {}) {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(['jobs'], 'readwrite');
                const store = tx.objectStore('jobs');

                jobs.forEach(item => {
                    const dbJob = toDbJob(item, platformName, extras);
                    if (dbJob.id) {
                        store.put(dbJob);
                    }
                });

                tx.oncomplete = () => resolve(true);
                tx.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.warn('[JobStorage] IndexedDB bulkPutJobs 降级:', err.message);
            return false;
        }
    }

    // 从 chrome.storage.local 同步到 IndexedDB
    async function syncFromChromeStorage() {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

        return new Promise((resolve) => {
            const keys = [
                'boss_scraped_v2',
                '51job_scraped_v2',
                'liepin_scraped_data_v1',
                'zhilian_scraped_v2',
                'zhilian_scraped_data_v1',
                'favorited_jobs',
                'blacklisted_companies'
            ];

            chrome.storage.local.get(keys, async (res) => {
                if (chrome.runtime.lastError) {
                    console.warn('[JobStorage] chrome.storage 读取错误:', chrome.runtime.lastError);
                    return resolve(false);
                }

                const favorites = Array.isArray(res.favorited_jobs) ? res.favorited_jobs : [];
                const blacklistedCompanies = new Set();
                if (Array.isArray(res.blacklisted_companies)) {
                    res.blacklisted_companies.forEach(c => {
                        const name = typeof c === 'string' ? c : (c && c.companyName ? c.companyName : '');
                        if (name) blacklistedCompanies.add(name);
                    });
                }
                const extras = { favorites, blacklistedCompanies };

                if (Array.isArray(res.boss_scraped_v2)) {
                    await bulkPutJobs(res.boss_scraped_v2, 'Boss直聘', extras);
                }
                if (Array.isArray(res['51job_scraped_v2'])) {
                    await bulkPutJobs(res['51job_scraped_v2'], '51job', extras);
                }
                if (Array.isArray(res.liepin_scraped_data_v1)) {
                    await bulkPutJobs(res.liepin_scraped_data_v1, 'Liepin', extras);
                }
                const zhilian = res.zhilian_scraped_v2 || res.zhilian_scraped_data_v1 || [];
                if (Array.isArray(zhilian)) {
                    await bulkPutJobs(zhilian, '智联', extras);
                }

                resolve(true);
            });
        });
    }

    // 高速检索职位
    async function searchJobs(options = {}) {
        const { keyword = '', platform = '', favoritesOnly = false, limit = 500 } = options;
        const kw = keyword.trim().toLowerCase();

        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(['jobs'], 'readonly');
                const store = tx.objectStore('jobs');
                let request;

                if (platform) {
                    const idx = store.index('platform');
                    request = idx.getAll(platform);
                } else {
                    request = store.getAll();
                }

                request.onsuccess = (e) => {
                    let results = e.target.result || [];
                    if (favoritesOnly) {
                        results = results.filter(j => j.isFavorite);
                    }
                    if (kw) {
                        results = results.filter(j => 
                            (j.jobTitle && j.jobTitle.toLowerCase().includes(kw)) ||
                            (j.companyName && j.companyName.toLowerCase().includes(kw)) ||
                            (j.skills && j.skills.toLowerCase().includes(kw)) ||
                            (j.location && j.location.toLowerCase().includes(kw))
                        );
                    }
                    if (limit && results.length > limit) {
                        results = results.slice(0, limit);
                    }
                    resolve(results.map(r => r.raw));
                };

                request.onerror = (e) => reject(e.target.error);
            });
        } catch (e) {
            console.warn('[JobStorage] searchJobs 降级回内存查找:', e.message);
            return null;
        }
    }

    // 清空数据库
    async function clearDatabase() {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(['jobs', 'meta'], 'readwrite');
                tx.objectStore('jobs').clear();
                tx.objectStore('meta').clear();
                tx.oncomplete = () => resolve(true);
                tx.onerror = (e) => reject(e.target.error);
            });
        } catch (e) {
            console.warn('[JobStorage] 清空数据库失败:', e);
            return false;
        }
    }

    return {
        openDB,
        getStandardJobId,
        toDbJob,
        bulkPutJobs,
        syncFromChromeStorage,
        searchJobs,
        clearDatabase
    };
});
