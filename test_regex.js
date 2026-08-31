const fs = require('fs');
const html = fs.readFileSync('/Users/wangyanan/Projects2/tampermonkey-js/zhilianzhaopin/zhilian_jobdetail_page.html', 'utf8');

const match = html.match(/__INITIAL_STATE__\s*=\s*(\{.*?\});/s);
console.log("Regex match success?", !!match);

const startIdx = html.indexOf('__INITIAL_STATE__');
const objStart = html.indexOf('{', startIdx);
const scriptEnd = html.indexOf('</script>', objStart);

console.log("startIdx", startIdx);
console.log("objStart", objStart);
console.log("scriptEnd", scriptEnd);

if (objStart !== -1 && scriptEnd !== -1) {
    let jsonStr = html.substring(objStart, scriptEnd).trim();
    // try to match the exact replace from the content script
    jsonStr = jsonStr.replace(/;$/, '');
    try { 
        JSON.parse(jsonStr); 
        console.log("Fallback parse success!");
    } catch(e) {
        console.log("Fallback JSON parse error. First 100 chars:", jsonStr.substring(0, 100));
        console.log("Last 100 chars:", jsonStr.substring(jsonStr.length - 100));
    }
}
