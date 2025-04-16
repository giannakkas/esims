// === /netlify/functions/order-paid-background.js ===
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const fs = require('fs');

const PENDING_PATH = '/tmp/pending-esims.json';

const readPending = () => {
  try {
    if (!fs.existsSync(PENDING_PATH)) return [];
    const content = fs.readFileSync(PENDING_PATH, 'utf8');
    return JSON.parse(content || '[]');
  } catch (err) {
    console.error('❌ Failed to read pending-esims.json:', err);
    return [];
  }
};

const writePending = (orders) => {
  try {
    fs.writeFileSync(PENDING_PATH, JSON.stringify(orders, null, 2));
  } catch (err) {
    console.error('❌ Failed to write pending-esims.json:', err);
  }
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  console.log("📦 Received new Shopify order webhook");

  try {
    const {
      MOBIMATTER_API_KEY,
      MOBIMATTER_MERCHANT_ID,
    } = process.env;

    console.log("🔑 Mobimatter Merchant ID:", MOBIMATTER_MERCHANT_ID);
    console.log("🔐 Mobimatter API Key Present:", !!MOBIMATTER_API_KEY);

    if (!MOBIMATTER_API_KEY || !MOBIMATTER_MERCHANT_ID) {
      console.error("❌ Missing API credentials");
      return { statusCode: 500, body: "Missing API credentials" };
    }

    const order = JSON.parse(event.body);
    const email = order?.email;
    const lineItems = order?.line_items || [];

    if (!email || lineItems.length === 0) {
      console.error("❌ Invalid order payload");
      return { statusCode: 400, body: "Invalid order payload" };
    }

    const lineItem = lineItems[0];
    const productId = lineItem.sku;
    console.log("🔎 Extracted product ID from SKU:", productId);

    console.log("📡 Creating Mobimatter order...");
    const createBody = { productId, customerEmail: email };

    const createOrderRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": MOBIMATTER_API_KEY,
        "merchantid": MOBIMATTER_MERCHANT_ID,
      },
      body: JSON.stringify(createBody),
    });

    const createOrderData = await createOrderRes.json();
    const externalOrderCode = createOrderData?.result?.orderId;

    if (!createOrderRes.ok || !externalOrderCode) {
      console.error("❌ Mobimatter order creation failed:", createOrderData);
      return { statusCode: 500, body: "Mobimatter order creation failed" };
    }

    console.log("✅ Created Mobimatter order:", externalOrderCode);

    let internalOrderId = null;
    for (let i = 0; i < 5; i++) {
      try {
        const res = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/by-code/${externalOrderCode}`, {
          headers: {
            "Content-Type": "application/json",
            "api-key": MOBIMATTER_API_KEY,
            "merchantid": MOBIMATTER_MERCHANT_ID,
          },
        });

        const data = await res.json();
        if (res.ok && data?.result?.id) {
          internalOrderId = data.result.id;
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 10000));
      } catch (err) {
        console.error(`❌ Error fetching internal ID: ${err.message}`);
      }
    }

    if (!internalOrderId) {
      console.warn(`🕓 Order not ready, adding to pending queue: ${externalOrderCode}`);
      const pending = readPending();
      pending.push({ externalOrderCode, email });
      writePending(pending);

      return {
        statusCode: 202,
        body: JSON.stringify({ message: "Queued for retry", orderId: externalOrderCode })
      };
    }

    const completeRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${internalOrderId}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': MOBIMATTER_API_KEY,
        'merchantid': MOBIMATTER_MERCHANT_ID,
      },
    });

    if (!completeRes.ok) {
      console.error(`❌ Failed to complete order ${internalOrderId}`);
      return { statusCode: 500, body: "Mobimatter order completion failed" };
    }

    await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/send-order-confirmation-to-customer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': MOBIMATTER_API_KEY,
        'merchantid': MOBIMATTER_MERCHANT_ID,
      },
      body: JSON.stringify({ orderId: internalOrderId, customerEmail: email }),
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "eSIM sent to customer", orderId: internalOrderId }),
    };
  } catch (err) {
    console.error("❌ Unexpected error:", err);
    return { statusCode: 500, body: "Unexpected error occurred" };
  }
};
