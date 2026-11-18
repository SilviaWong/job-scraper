const fs = require('fs');
const html = fs.readFileSync('/Users/wangyanan/Projects2/tampermonkey-js/51job/51job_list_page.html', 'utf8');

// Simulate DOM parsing
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const dom = new JSDOM(html);
const document = dom.window.document;

const jobCards = document.querySelectorAll('.sensors_exposure[sensorsdata]');
console.log(`Found ${jobCards.length} job cards via sensors_exposure`);

if (jobCards.length > 0) {
    const card = jobCards[0];
    const dataStr = card.getAttribute('sensorsdata');
    try {
        const data = JSON.parse(dataStr);
        console.log("Sample Data:", data);
        
        // Let's also check if the anchor tag href can be extracted
        const link = card.querySelector('.joblist-item-jobname a, a[href*="jobs.51job.com/all/"]');
        if (link) {
            console.log("Found link:", link.href);
        } else {
            console.log("Could not find anchor link directly inside card. Let's see card structure.");
            console.log(card.innerHTML.substring(0, 500));
        }
    } catch(e) {
        console.error(e);
    }
}
