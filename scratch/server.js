const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.method === 'POST') {
        const dest = path.join(__dirname, '../libs/xlsx.full.min.js');
        const writeStream = fs.createWriteStream(dest);
        req.pipe(writeStream);
        req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('File saved successfully');
            console.log('File successfully saved to ' + dest);
            setTimeout(() => process.exit(0), 1000); 
        });
    } else {
        res.writeHead(405);
        res.end('Method Not Allowed');
    }
});

server.listen(9999, () => {
    console.log('Server listening on port 9999');
});
