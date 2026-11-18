const fs = require('fs');

function extractState(htmlPath) {
    if (!fs.existsSync(htmlPath)) return null;
    const html = fs.readFileSync(htmlPath, 'utf8');
    const startIdx = html.indexOf('__INITIAL_STATE__');
    if (startIdx === -1) return null;
    const objStart = html.indexOf('{', startIdx);
    const scriptEnd = html.indexOf('</script>', objStart);
    let jsonStr = html.substring(objStart, scriptEnd).trim().replace(/;\s*$/, '');
    try {
        return JSON.parse(jsonStr);
    } catch (e) {
        return null;
    }
}

function findKeys(obj, keywords) {
    let results = [];
    function traverse(node, path) {
        if (!node || typeof node !== 'object') return;
        for (let k in node) {
            let lowerK = k.toLowerCase();
            let val = node[k];
            if (keywords.some(kw => lowerK.includes(kw))) {
                results.push({ path: path + '.' + k, value: val });
            }
            if (typeof val === 'object' && val !== null) {
                traverse(val, path + '.' + k);
            }
        }
    }
    traverse(obj, '');
    return results;
}

const listState = extractState('/Users/wangyanan/Projects2/tampermonkey-js/zhilianzhaopin/zhilian_list_page.html');
const detailState = extractState('/Users/wangyanan/Projects2/tampermonkey-js/zhilianzhaopin/zhilian_jobdetail_page.html');

console.log("=== LIST PAGE HR INFO ===");
if (listState && listState.positionList) {
    // just check the first job
    let job = listState.positionList[0];
    let hrKeys = findKeys(job, ['active', 'time', 'staff', 'hr']);
    console.log(hrKeys);
}

console.log("\n=== DETAIL PAGE HR INFO ===");
if (detailState && detailState.jobDetail) {
    let job = detailState.jobDetail;
    let hrKeys = findKeys(job, ['active', 'time', 'staff', 'hr', 'last']);
    console.log(hrKeys.filter(k => typeof k.value !== 'object' || Array.isArray(k.value)));
}
