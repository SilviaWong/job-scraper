// === 新版: API拦截方案 ===
(function () {
    'use strict';

    let isRunning = false;
    const currentSource = 'zhilian_scraped_data_v2';

    // 用于保存拦截到的 JSON 数据队列
    let interceptedJobs = [];



    function notifyPopupStatus(statusText, count = 0) {
        chrome.runtime.sendMessage({
            action: 'zhilian_status_update',
            statusText: statusText,
            count: count
        });
    }

    // 监听来自 MAIN world 的拦截数据
    window.addEventListener('message', (event) => {
        if (event.source !== window && event.source !== window.parent) return;
        if (event.data && event.data.type === 'ZHILIAN_LIST_DATA') {
            const jobs = event.data.data;
            if (jobs && jobs.length > 0) {
                interceptedJobs = interceptedJobs.concat(jobs);
                console.log(`[智联提取器] 收到 ${jobs.length} 条数据，队列总数: ${interceptedJobs.length}`);

                if (isRunning) {
                    processInterceptedJobs();
                }
            }
        }
    });

    function processInterceptedJobs() {
        if (!isRunning || interceptedJobs.length === 0) return;

        chrome.storage.local.get([currentSource], function (result) {
            let allData = result[currentSource] || [];
            let addedCount = 0;
            let syncJobs = [];


            const now = new Date();
            const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

            interceptedJobs.forEach(rawJob => {
                let jobData = Object.assign({}, rawJob);

                let position = (jobData.jobDetailData && jobData.jobDetailData.position) || {};
                let base = position.base || {};
                const jobId = base.positionId || jobData.jobId;
                if (!jobId) return;

                // 补充外部的 jobName 和 URL
                jobData.list_jobName = rawJob.name || rawJob.jobName || '';
                jobData.list_url = rawJob.positionUrl || rawJob.positionURL || rawJob.url || '';
                jobData['抓取时间'] = timeStr; // 中文特殊字段用于排序标识
                jobData['平台'] = 'zhilian';
                jobData.platform = 'zhilian';

                const existingIndex = allData.findIndex(j => {
                    let jPosition = (j.jobDetailData && j.jobDetailData.position) || {};
                    let jBase = jPosition.base || {};
                    return (jBase.positionId || j.jobId) === jobId;
                });

                if (existingIndex !== -1) {
                    jobData['创建时间'] = allData[existingIndex]['创建时间'] || timeStr;
                    allData[existingIndex] = jobData;
                } else {
                    jobData['创建时间'] = timeStr;
                    allData.push(jobData);
                    addedCount++;
                }

                let syncJob = Object.assign({}, jobData);
                syncJob['平台'] = 'zhilian';
                syncJob['数据来源'] = currentSource;
                syncJob.platform = 'zhilian';
                syncJob.dataSource = currentSource;
                syncJobs.push(syncJob);
            });

            chrome.storage.local.set({
                [currentSource]: allData
            }, () => {
                interceptedJobs = []; // 清空已处理
                notifyPopupStatus(`成功抓取并解析 ${addedCount} 条新数据`, allData.length);
                console.log(`✅ [智联] 保存完毕，当前 v2: ${allData.length} 条`);

                if (syncJobs.length > 0) {
                    fetch('http://localhost:3000/api/jobs', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(syncJobs)
                    }).catch(err => {
                        console.log('[Zhilian Scraper] Local server sync failed:', err);
                    });

                    // https://job-dashboard-bgr.pages.dev (已注释)
                    // fetch('https://job-dashboard-bgr.pages.dev/api/jobs', {
                    //     method: 'POST',
                    //     headers: { 'Content-Type': 'application/json' },
                    //     body: JSON.stringify(syncJobs)
                    // }).catch(err => {
                    //     // 如果远程服务器未开启，这里会忽略错误，不影响原有逻辑
                    //     console.log('[Zhilian Scraper] Remote server sync failed (expected if not running):', err);
                    // });
                }

                // 尝试自动翻页逻辑
                attemptAutoScroll();
            });
        });
    }

    function attemptAutoScroll() {
        if (!isRunning) return;

        // 由于是列表拦截模式，我们需要让页面去触发下一页的请求。
        // 如果是瀑布流加载，我们可以滚动到底部。
        // 如果是分页按钮，我们可以点击下一页。
        const nextBtn = Array.from(document.querySelectorAll('button, a')).find(el =>
            el.innerText && el.innerText.trim() === '下一页' &&
            !el.disabled &&
            !el.classList.contains('soupager__btn--disable') &&
            !el.classList.contains('disabled') &&
            !el.classList.contains('is-disabled')
        );

        if (nextBtn) {
            notifyPopupStatus('浏览当前页面并准备翻页...');

            // 先平滑滚动到底部，模拟真人浏览行为，确保所有懒加载元素或统计代码触发
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });

            setTimeout(() => {
                if (isRunning) {
                    notifyPopupStatus('正在自动翻页...');
                    nextBtn.click();
                    // 等待下一页数据到达...
                }
            }, 2500 + Math.random() * 1000);
        } else {
            // 尝试滚动加载
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            notifyPopupStatus('尝试下拉加载/等待新数据...');
        }
    }


    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'start_zhilian_csr') {
            isRunning = true;
            processInterceptedJobs(); // 处理之前累积的

            if (interceptedJobs.length === 0) {
                notifyPopupStatus('CSR模式开始抓取，正在等待页面加载数据...');
                // 触发一下当前页的加载
                window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            }
            sendResponse({ status: "started" });
        } else if (request.action === 'stop_zhilian_csr') {
            isRunning = false;
            notifyPopupStatus('已停止抓取');
            sendResponse({ status: "stopped" });
        } else if (request.action === 'get_status_csr') {
            chrome.storage.local.get([currentSource], function (res) {
                const count = (res[currentSource] || []).length;
                sendResponse({ isRunning: isRunning, status: isRunning ? 'API拦截抓取中...' : '闲置', count: count });
            });
            return true;
        }
    });

})();
