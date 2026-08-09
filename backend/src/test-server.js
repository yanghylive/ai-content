const http = require('http');
http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
        console.log("JSON Body:", JSON.stringify(JSON.parse(body), null, 2));
        res.end('{"data":[{"url":"http://test.com/img"}]}');
        process.exit(0);
    });
}).listen(9999);
