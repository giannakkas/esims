// === /netlify/functions/order-paid-background.js ===
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const fs = require('fs');
const path = require('path');

const PENDING_PATH = path.join(__dirname, '..', 'pending-esims.json');
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
    console.log("⚠️ Invalid method:", event.httpMethod);
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
      console.error("❌ Missing API credentials in environment variables");
      return { statusCode: 500, body: "Missing Mobimatter API credentials" };
    }

    const order = JSON.parse(event.body);
    const email = order?.email;
    const lineItems = order?.line_items || [];

    console.log(`🧾 Order ID: ${order?.id}`);
    console.log(`📧 Customer email: ${email}`);
    console.log(`🛒 Line items: ${lineItems.length}`);

    if (!email || lineItems.length === 0) {
      console.error("❌ Missing email or line items in the order payload");
      return { statusCode: 400, body: "Invalid order data" };
    }

    const lineItem = lineItems[0];
    const productId = lineItem.sku;

    console.log("🔎 Extracted product ID from SKU:", productId);
    console.log("🧾 Line item title:", lineItem.title);

    if (!productId) {
      console.error("❌ Missing productId (SKU) in the order");
      return { statusCode: 400, body: "Missing productId (SKU) in order item" };
    }

    console.log("📡 Creating Mobimatter order...");
    const createBody = { productId, customerEmail: email };
    console.log("📦 Request payload to Mobimatter:", createBody);

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
    console.log("📥 Mobimatter createOrder response:", createOrderData);

    const externalOrderCode = createOrderData?.result?.orderId;
    if (!createOrderRes.ok || !externalOrderCode) {
      console.error("❌ Mobimatter order creation failed:", createOrderData);
      return { statusCode: 500, body: "Mobimatter order creation failed" };
    }

    console.log("✅ Created Mobimatter order:", externalOrderCode);

    console.log("⏳ Looking up internal Mobimatter order ID...");

    let internalOrderId = null;
    const maxRetries = 5;

    for (let i = 0; i < maxRetries; i++) {
      try {
        console.log(`🔁 Attempt ${i + 1} of ${maxRetries}: fetching internal order ID for ${externalOrderCode}`);
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
          console.log("✅ Internal order ID found:", internalOrderId);
          break;
        }

        console.warn("❌ Not found yet:", data);
      } catch (err) {
        console.error(`❌ Error during retry ${i + 1}: ${err.message}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 10000));
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

    console.log("📡 Completing Mobimatter order with ID:", internalOrderId);
    const completeRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${internalOrderId}/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": MOBIMATTER_API_KEY,
        "merchantid": MOBIMATTER_MERCHANT_ID,
      },
    });

    const completeText = await completeRes.text();
    console.log("📥 Mobimatter complete response:", completeText);

    if (!completeRes.ok) {
      console.error(`❌ Failed to complete order ${internalOrderId}`);
      return { statusCode: 500, body: "Mobimatter order completion failed" };
    }

    console.log("✅ Completed Mobimatter order:", internalOrderId);
    console.log("📧 Sending confirmation email to customer...");

    const sendEmailRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/order/send-order-confirmation-to-customer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": MOBIMATTER_API_KEY,
        "merchantid": MOBIMATTER_MERCHANT_ID,
      },
      body: JSON.stringify({ orderId: internalOrderId, customerEmail: email }),
    });

    const sendEmailData = await sendEmailRes.json();
    console.log("📥 Mobimatter email send response:", sendEmailData);

    if (!sendEmailRes.ok) {
      console.error("❌ Failed to send confirmation email:", sendEmailData);
      return { statusCode: 500, body: "Mobimatter email send failed" };
    }

    console.log("✅ eSIM confirmation email sent to:", email);
    console.log("⚙️ Function complete");

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "eSIM sent to customer", orderId: internalOrderId }),
    };

  } catch (err) {
    console.error("❌ Uncaught error:", err);
    return { statusCode: 500, body: "Unexpected error occurred" };
  }
};
