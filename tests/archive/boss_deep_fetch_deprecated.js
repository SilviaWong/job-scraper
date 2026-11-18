// 深度抓取功能已从UI中移除，这部分代码移动至此作备份
// 过去用于在列表抓取时，对每一项自动发起请求去抓取详情页 HTML，现在已被废弃。
// 当前代码中直接进入详情页单页抓取 (scrapeSinglePage) 已经可以完美平替。

function fetchDeepDataAndSave(jobId, row, callback) {
    const detailUrl = `https://www.zhipin.com/job_detail/${jobId}.html`;
    notifyPopupStatus(`提取深层数据...`);
    fetch(detailUrl)
        .then(res => res.text())
        .then(html => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const companyNameNode = doc.querySelector('.business-info-box .company-name');
            if (companyNameNode) {
                const span = companyNameNode.querySelector('span');
                if (span) span.remove();
                row['_fetched_companyFullName'] = cleanStr(companyNameNode.textContent);
            }

            const addressNode = doc.querySelector('.location-address');
            if (addressNode) row['_fetched_fullAddress'] = cleanStr(addressNode.textContent);

            const updateNode = doc.querySelector('p.gray');
            if (updateNode && updateNode.textContent.includes('页面更新时间')) {
                row['_fetched_updateTime'] = cleanStr(updateNode.textContent.replace('页面更新时间：', ''));
            }

            const statusNode = doc.querySelector('.job-status');
            if (statusNode) row['_fetched_jobStatus'] = cleanStr(statusNode.textContent);

            upsertData(jobId, row, callback);
        })
        .catch(err => {
            console.error(err);
            upsertData(jobId, row, callback);
        });
}
