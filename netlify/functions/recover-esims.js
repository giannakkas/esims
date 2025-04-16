// === /netlify/functions/recover-esims.js ===
const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const PENDING_PATH = '/tmp/pending-esims.json';

const readPendingOrders = () => {
  try {
    if (!fs.existsSync(PENDING_PATH)) return [];
    const raw = fs.readFileSync(PENDING_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('❌ Failed to read pending-esims.json:', err);
    return [];
  }
};

const writePendingOrders = (orders) => {
  try {
    fs.writeFileSync(PENDING_PATH, JSON.stringify(orders, null, 2));
  } catch (err) {
    console.error('❌ Failed to write pending-esims.json:', err);
  }
};

exports.handler = async () => {
  console.log('⏰ Running scheduled eSIM recovery...');

  const {
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
  } = process.env;

  const pending = readPendingOrders();
  if (pending.length === 0) {
    console.log('📭 No pending orders to process.');
    return { statusCode: 200, body: 'No pending orders.' };
  }

  const stillPending = [];

  for (const order of pending) {
    const { externalOrderCode, email } = order;
    console.log(`🔁 Checking ${externalOrderCode}...`);

    try {
      const res = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/by-code/${externalOrderCode}`, {
        headers: {
          'Content-Type': 'application/json',
          'api-key': MOBIMATTER_API_KEY,
          'merchantid': MOBIMATTER_MERCHANT_ID,
        },
      });

      const data = await res.json();
      if (res.ok && data?.result?.id) {
        const internalId = data.result.id;
        console.log(`✅ Found internal ID: ${internalId}`);

        const completeRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${internalId}/complete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': MOBIMATTER_API_KEY,
            'merchantid': MOBIMATTER_MERCHANT_ID,
          },
        });

        const completeText = await completeRes.text();
        console.log(`📥 Completion response for ${internalId}:`, completeText);

        if (completeRes.ok) {
          await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/send-order-confirmation-to-customer`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'api-key': MOBIMATTER_API_KEY,
              'merchantid': MOBIMATTER_MERCHANT_ID,
            },
            body: JSON.stringify({ orderId: internalId, customerEmail: email }),
          });

          console.log(`✅ Email sent for recovered order ${externalOrderCode}`);
        } else {
          console.error(`❌ Could not complete recovered order ${internalId}`);
          stillPending.push(order);
        }
      } else {
        console.log(`🕓 Still not found: ${externalOrderCode}`);
        stillPending.push(order);
      }
    } catch (err) {
      console.error(`❌ Error handling ${externalOrderCode}:`, err);
      stillPending.push(order);
    }
  }

  writePendingOrders(stillPending);

  console.log(`🗂️ Updated queue: ${stillPending.length} pending orders`);
  return { statusCode: 200, body: 'Recovery function finished.' };
};
