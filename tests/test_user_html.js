const fs = require('fs');
const html = fs.readFileSync('/Users/wangyanan/Projects2/tampermonkey-js/zhilianzhaopin/zhilian_jobdetail_page.html', 'utf8');

let initialState = null;
const match = html.match(/__INITIAL_STATE__\s*=\s*(\{.*?\});/s);
if (match) {
    console.log("Regex match found!");
    try {
        initialState = JSON.parse(match[1]);
    } catch(e) {
        console.log("JSON parse error:", e);
    }
} else {
    console.log("Regex match not found. Trying fallback...");
    const startIdx = html.indexOf('__INITIAL_STATE__');
    if (startIdx !== -1) {
        const objStart = html.indexOf('{', startIdx);
        const scriptEnd = html.indexOf('</script>', objStart);
        if (objStart !== -1 && scriptEnd !== -1) {
            let jsonStr = html.substring(objStart, scriptEnd).trim();
            jsonStr = jsonStr.replace(/;$/, '');
            try { 
                initialState = JSON.parse(jsonStr); 
                console.log("Fallback parse success!");
            } catch(e) {
                console.log("Fallback JSON parse error:", e);
            }
        }
    }
}

if (initialState) {
    const jobDetailData = initialState.jobDetail || {};
    const pos = jobDetailData.detailedPosition || {};
    console.log("Found PositionName:", pos.positionName || pos.name || '');
    console.log("Found Salary:", pos.salary || '');
    console.log("Found Description:", pos.jobDesc || '');
} else {
    console.log("initialState is null");
}
