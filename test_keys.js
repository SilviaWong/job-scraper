const fs = require('fs');
const html = fs.readFileSync('/Users/wangyanan/Projects2/tampermonkey-js/zhilianzhaopin/zhilian_jobdetail_page.html', 'utf8');
const startIdx = html.indexOf('__INITIAL_STATE__');
const objStart = html.indexOf('{', startIdx);
const scriptEnd = html.indexOf('</script>', objStart);
let jsonStr = html.substring(objStart, scriptEnd).trim().replace(/;\s*$/, '');
let state = JSON.parse(jsonStr);

let extDetail = state.companyExtDetail || {};
console.log(JSON.stringify(extDetail, null, 2).substring(0, 2000));
