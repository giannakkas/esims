// netlify/functions/order-paid.js
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const MOBIMATTER_API_BASE = "https://api.mobimatter.com/mobimatter/api/v2";
const MOBIMATTER_API_KEY = process.env.MOBIMATTER_API_KEY;

exports.handler = async (event) => {
  try {
    console.log("📦 Shopify webhook received.");
    console.log("🧪 MOBIMATTER_API_KEY present:", !!MOBIMATTER_API_KEY);

    if (!event.body) {
      console.error("❌ Invalid JSON: No body provided");
      return { statusCode: 400, body: "No body" };
    }

    const order = JSON.parse(event.body);
    const lineItem = order.line_items?.[0];
    const sku = lineItem?.sku;
    const email = order.email;
    const shopifyOrderId = order.id;

    console.log("✅ Webhook JSON parsed.");
    console.log("🔍 Extracted:");
    console.log("→ SKU:", sku);
    console.log("→ Email:", email);
    console.log("→ Shopify Order ID:", shopifyOrderId);

    if (!sku || !email) {
      console.error("❌ Missing SKU or email");
      return { statusCode: 400, body: "Missing SKU or email" };
    }

    console.log("🌐 Fetching Mobimatter /v2 products...");
    const productsRes = await fetch(`${MOBIMATTER_API_BASE}/products`, {
      headers: {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": MOBIMATTER_API_KEY,
      },
    });

    const productsText = await productsRes.text();
    console.log("📦 Raw Mobimatter products response:", productsText);

    let productsJson;
    try {
      productsJson = JSON.parse(productsText);
    } catch (parseErr) {
      console.error("❌ Failed to parse Mobimatter response JSON:", parseErr.message);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Invalid JSON from Mobimatter" }),
      };
    }

    const products = Array.isArray(productsJson.result)
      ? productsJson.result
      : Array.isArray(productsJson)
      ? productsJson
      : [];

    console.log("📦 Mobimatter products returned:", products.length);

    const matched = products.find((p) => p.uniqueId === sku);
    if (!matched) {
      console.error("❌ Product not found in Mobimatter:", sku);
      return { statusCode: 404, body: "Product not found in Mobimatter" };
    }

    const productId = matched.productId;
    console.log("✅ Found Mobimatter productId:", productId);

    console.log("📝 Creating Mobimatter order...");
    const createRes = await fetch(`${MOBIMATTER_API_BASE}/order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": MOBIMATTER_API_KEY,
      },
      body: JSON.stringify({ productId, email }),
    });

    const createText = await createRes.text();
    console.log("📄 Create order response:", createText);
    const createJson = JSON.parse(createText);
    const mobimatterOrderId = createJson.result?.orderId;
    if (!mobimatterOrderId) throw new Error("Failed to create Mobimatter order");

    console.log("✅ Mobimatter order created:", mobimatterOrderId);

    // ⏳ Poll for QR readiness (max 10 tries with delay)
    let activation;
    for (let attempt = 1; attempt <= 10; attempt++) {
      console.log(`🔄 Checking QR readiness... attempt ${attempt}`);
      const statusRes = await fetch(`${MOBIMATTER_API_BASE}/order/${mobimatterOrderId}`, {
        headers: {
          "Content-Type": "application/json",
          "Ocp-Apim-Subscription-Key": MOBIMATTER_API_KEY,
        },
      });

      const statusText = await statusRes.text();
      console.log(`📄 Status check response attempt ${attempt}:`, statusText);

      let statusJson;
      try {
        statusJson = JSON.parse(statusText);
      } catch (e) {
        console.error("❌ Failed to parse status response JSON:", e.message);
        continue;
      }

      activation = statusJson.result?.activation;

      if (activation?.imageUrl) {
        console.log("✅ QR code ready:", activation.imageUrl);
        break;
      }

      console.log("⏳ QR not ready yet. Waiting 3 seconds...");
      await new Promise((r) => setTimeout(r, 3000));
    }

    if (!activation?.imageUrl) {
      console.warn("⚠️ QR code not ready after polling. Skipping email.");
      return {
        statusCode: 202,
        body: JSON.stringify({ message: "QR code not ready yet" }),
      };
    }

    // ✅ Complete the order
    console.log("✅ Completing Mobimatter order...");
    const completeRes = await fetch(`${MOBIMATTER_API_BASE}/order/${mobimatterOrderId}/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": MOBIMATTER_API_KEY,
      },
      body: JSON.stringify({}),
    });

    const completeText = await completeRes.text();
    console.log("📄 Complete order response:", completeText);

    // 📧 Send confirmation email using Mobimatter API
    console.log("📧 Sending confirmation email via Mobimatter...");
    const sendRes = await fetch(`${MOBIMATTER_API_BASE}/order/${mobimatterOrderId}/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": MOBIMATTER_API_KEY,
      },
      body: JSON.stringify({ email }),
    });

    const sendText = await sendRes.text();
    console.log("📨 Send email response:", sendText);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, mobimatterOrderId }),
    };
  } catch (err) {
    console.error("❌ Error in order-paid handler:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
