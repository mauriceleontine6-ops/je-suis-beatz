const https = require('https');

const payload = {
  event: 'payment.success',
  data: {
    id: 8132,
    reference: 'SANDBOX_BPFPPYVDAHFMFMYE',
    status: 'success',
    scenario: 'success',
    amount: 2500,
    currency: 'XOF',
    customer: { email: 'test@example.com', name: 'Test User' }
  }
};

const data = JSON.stringify(payload);

const options = {
  hostname: 'geniuspaywebhook-qyfkwosfca-uc.a.run.app',
  path: '/',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = https.request(options, (res) => {
  console.log('statusCode:', res.statusCode);
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log('response body:', body);
  });
});

req.on('error', (e) => {
  console.error('request error:', e);
});

req.write(data);
req.end();
