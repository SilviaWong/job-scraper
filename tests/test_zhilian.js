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
    fs.writeFileSync('zhilian_detail.html', html);
    console.log("HTML saved. Length:", html.length);
    
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
                jsonStr = jsonStr.replace(/;\s*$/, '');
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
        console.log("initialState keys:", Object.keys(initialState));
        if (initialState.jobDetail) {
            console.log("jobDetail keys:", Object.keys(initialState.jobDetail));
            console.log("detailedPosition keys:", Object.keys(initialState.jobDetail.detailedPosition || {}));
        } else {
            console.log("jobDetail NOT FOUND!");
            // search for alternative keys
            for (let k in initialState) {
                if (initialState[k] && typeof initialState[k] === 'object' && JSON.stringify(initialState[k]).includes('salary')) {
                    console.log("Found salary in key:", k);
                }
            }
        }
    }
}
fetchZhilian();
