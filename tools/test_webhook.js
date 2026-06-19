const createUrl = 'https://creategeniuspayment-qyfkwosfca-uc.a.run.app';
const webhookUrl = 'https://geniuspaywebhook-qyfkwosfca-uc.a.run.app';

async function main() {
  const orderData = {
    amount: 2500,
    currency: 'XOF',
    customer_name: 'Test User',
    customer_email: 'test@je-suis-beatz.com',
    customer_phone: '+22500000000',
    success_url: 'https://je-suis-beatz.web.app/?payment_status=success',
    error_url: 'https://je-suis-beatz.web.app/?payment_status=failed',
    metadata: { environment: 'sandbox' }
  };

  console.log('Creating GeniusPay payment...');
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderData })
  });
  const createBody = await createRes.text();
  let createJson;
  try {
    createJson = JSON.parse(createBody);
  } catch (e) {
    console.error('Failed parsing create response:', createBody);
    process.exit(1);
  }

  console.log('createGeniusPayment status:', createRes.status);
  console.log('createGeniusPayment body:', JSON.stringify(createJson, null, 2));

  if (!createJson.success) {
    console.error('Payment creation failed, aborting.');
    process.exit(1);
  }

  const payload = {
    event: 'payment.success',
    data: {
      id: createJson.payment?.data?.id || null,
      reference: createJson.payment?.data?.reference || null,
      status: 'success',
      scenario: 'success',
      amount: 2500,
      currency: 'XOF',
      customer: {
        email: orderData.customer_email,
        name: orderData.customer_name
      }
    }
  };

  console.log('Sending webhook payload...');
  const hookRes = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const hookText = await hookRes.text();
  console.log('webhook status:', hookRes.status);
  console.log('webhook response:', hookText);
}

main().catch((err) => {
  console.error('Test failure:', err);
  process.exit(1);
});