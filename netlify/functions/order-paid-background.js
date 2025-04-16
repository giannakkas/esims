// === /netlify/functions/order-paid-background.js ===
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

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

    let completeSuccess = false;
    for (let i = 1; i <= 3; i++) {
      console.log(`🚀 Attempt ${i} to complete order ${externalOrderCode}`);
      const completeRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/order/complete", {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/plain',
          'api-key': MOBIMATTER_API_KEY,
          'merchantid': MOBIMATTER_MERCHANT_ID,
        },
        body: JSON.stringify({
          orderId: externalOrderCode,
          notes: 'Auto-completed by Shopify integration'
        }),
      });

      const completeText = await completeRes.text();
      console.log(`📥 Completion response:`, completeText);

      if (completeRes.ok) {
        completeSuccess = true;
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    if (!completeSuccess) {
      console.error(`❌ Could not complete order ${externalOrderCode} after retries`);
      return { statusCode: 500, body: "Mobimatter order completion failed" };
    }

    const emailRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/send-order-confirmation-to-customer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': MOBIMATTER_API_KEY,
        'merchantid': MOBIMATTER_MERCHANT_ID,
      },
      body: JSON.stringify({ orderId: externalOrderCode, customerEmail: email }),
    });

    const emailText = await emailRes.text();
    console.log(`📧 Email response:`, emailText);

    if (!emailRes.ok) {
      console.error(`❌ Email failed to send for ${externalOrderCode}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "eSIM order completed and email sent", orderId: externalOrderCode }),
    };
  } catch (err) {
    console.error("❌ Unexpected error:", err);
    return { statusCode: 500, body: "Unexpected error occurred" };
  }
};
