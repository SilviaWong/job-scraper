const fs = require('fs');
async function fetchZhilian() {
    const url = "https://www.zhaopin.com/jobdetail/CC254512410J40757804616.htm";
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9'
        }
    });
    const html = await response.text();
    const startIdx = html.indexOf('__INITIAL_STATE__');
    const objStart = html.indexOf('{', startIdx);
    const scriptEnd = html.indexOf('</script>', objStart);
    let jsonStr = html.substring(objStart, scriptEnd).trim();
    jsonStr = jsonStr.replace(/;\s*$/, '');
    let initialState = JSON.parse(jsonStr); 
    const pos = initialState.jobDetail.detailedPosition;
    console.log("positionName:", pos.positionName);
    console.log("salary:", pos.salary);
    console.log("education:", pos.education);
    console.log("workingExp:", pos.workingExp);
}
fetchZhilian();
