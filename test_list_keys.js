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

const listState = extractState('/Users/wangyanan/Projects2/tampermonkey-js/zhilianzhaopin/zhilian_list_page.html');
if (listState) {
    console.log("Keys in listState:", Object.keys(listState));
} else {
    console.log("Failed to parse listState");
}
