const fs = require('fs');
const data = JSON.parse(fs.readFileSync('/Users/wangyanan/Projects2/tampermonkey-js/51job/51job_intercepted_api_1783425303219.json', 'utf8'));

for (let req of data) {
    if (req.url && req.url.includes('api/job/search-pc')) {
        let json = req.data;
        if (json && json.resultbody && json.resultbody.job && json.resultbody.job.items) {
            console.log("Found items:", json.resultbody.job.items.length);
            console.log("First item sample keys:", Object.keys(json.resultbody.job.items[0]));
        } else {
            console.log("Structure does not match!");
            if (json && json.resultbody) {
                console.log("resultbody keys:", Object.keys(json.resultbody));
            }
        }
        break;
    }
}
