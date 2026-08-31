const fs = require('fs');
const html = fs.readFileSync('/Users/wangyanan/Projects2/tampermonkey-js/zhilianzhaopin/zhilian_list_page.html', 'utf8');
const startIdx = html.indexOf('__INITIAL_STATE__');
const objStart = html.indexOf('{', startIdx);
const scriptEnd = html.indexOf('</script>', objStart);
let jsonStr = html.substring(objStart, scriptEnd).trim().replace(/;\s*$/, '');
let state = JSON.parse(jsonStr);

let list = state.positionList || [];
console.log(JSON.stringify(list[0] || {}, null, 2));
