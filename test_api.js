
const https = require('https');

const apiKey = {
    "encrypted": "7ca1d8beb31c24d4fcacf34a2c2ccf39552fb0202fb00fe2a656d86698f81ab962648320ced8d4d8ece0c758d588f3ec0c4a15efd795edc96aaf667082194f78c291730d9fdad2b1ef8d4a72fd1a09df463584f31e253a9dbc00c8320f0c923c3c99c558819a1004a5039c081b5ed63f173401392e0114f3",
    "iv": "c7ef84bd5c23f0953609e08374f467ef",
    "authTag": "0b036d8655543033f6c689eb3fc5d4f7"
};

const options = {
    hostname: 'api-proxy.tegasfx.com',
    port: 443,
    path: '/rest/ping?version=1.0.0',
    method: 'GET',
    headers: {
        'Authorization': `Bearer ${JSON.stringify(apiKey)}`,
        'Content-Type': 'application/json'
    }
};

const req = https.request(options, (res) => {
    let data = '';
    console.log('Status Code:', res.statusCode);
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        console.log('Body:', data);
    });
});

req.on('error', (e) => {
    console.error('Error:', e);
});

req.end();
