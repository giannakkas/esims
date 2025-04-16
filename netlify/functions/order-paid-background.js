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
    const customerName = `${order?.customer?.first_name || ''} ${order?.customer?.last_name || ''}`.trim();
    const merchantOrderId = order?.id?.toString();
    console.log("🔎 Extracted product ID from SKU:", productId);

    console.log("📡 Creating Mobimatter order...");
    const createBody = { productId, customerEmail: email };

    const createOrderRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": MOBIMATTER_API_KEY,
      },
      body: JSON.stringify(createBody),
    });

    const createOrderText = await createOrderRes.text();
    let createOrderData = null;
    try {
      createOrderData = JSON.parse(createOrderText);
    } catch (e) {
      console.error("❌ Could not parse createOrder response:", createOrderText);
      return { statusCode: 500, body: "Invalid JSON from Mobimatter createOrder" };
    }

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

    console.log("⏳ Waiting before internal ID lookup...");
    await new Promise(resolve => setTimeout(resolve, 10000));

    console.log("🔍 Fetching internal order ID for email sending...");
    let internalOrderId = null;

    for (let attempt = 1; attempt <= 5; attempt++) {
      console.log(`🔁 Attempt ${attempt} to fetch internal ID for ${externalOrderCode}`);
      const lookupRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/by-code/${externalOrderCode}`, {
        headers: {
          'api-key': MOBIMATTER_API_KEY,
        },
      });

      try {
        const lookupData = await lookupRes.json();
        internalOrderId = lookupData?.result?.id;

        if (internalOrderId) break;

        console.warn(`❌ Not found yet:`, lookupData);
      } catch (err) {
        const fallbackText = await lookupRes.text();
        console.warn(`❌ Error or non-JSON response:`, fallbackText);
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    if (!internalOrderId) {
      console.error(`❌ Could not fetch internal order ID for ${externalOrderCode}`);
    } else {
      const emailBody = {
        orderId: externalOrderCode,
        customer: {
          id: email,
          name: customerName || "Shopify Customer",
          email: email,
          ccEmail: email,
          phone: order?.phone || "",
        },
        amountCharged: parseFloat(order?.total_price || 0),
        currency: order?.currency || "USD",
        merchantOrderId: merchantOrderId,
      };

      const emailRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/email", {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/plain',
          'api-key': MOBIMATTER_API_KEY,
        },
        body: JSON.stringify(emailBody),
      });

      const emailText = await emailRes.text();
      console.log(`📧 Email response:`, emailText);

      if (!emailRes.ok) {
        console.error(`❌ Email failed to send for ${externalOrderCode}`);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "eSIM order completed and email attempted", orderId: externalOrderCode }),
    };
  } catch (err) {
    console.error("❌ Unexpected error:", err);
    return { statusCode: 500, body: "Unexpected error occurred" };
  }
};
