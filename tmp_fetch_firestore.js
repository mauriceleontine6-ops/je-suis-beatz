const https = require('https');
const url = 'https://firestore.googleapis.com/v1/projects/je-suis-beatz/databases/(default)/documents/beats?pageSize=20';
https.get(url, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log(JSON.stringify(json, null, 2));
    } catch (e) {
      console.error('PARSE_ERROR', e.message, data);
    }
  });
}).on('error', err => console.error('HTTP_ERROR', err.message));
