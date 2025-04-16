// netlify/functions/order-paid.js
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const MOBIMATTER_API_BASE = "https://api.mobimatter.com/mobimatter/api/v2";

exports.handler = async (event) => {
  try {
    console.log("📦 Shopify webhook received.");

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
      return { statusCode: 400, body: "Missing SKU or email" };
    }

    console.log("🌐 Fetching Mobimatter /v2 products...");
    const productsRes = await fetch(`${MOBIMATTER_API_BASE}/products`);
    const productsJson = await productsRes.json();

    const products = Array.isArray(productsJson.result)
      ? productsJson.result
      : Array.isArray(productsJson)
      ? productsJson
      : [];

    const matched = products.find((p) => p.uniqueId === sku);
    if (!matched) throw new Error("Product not found in Mobimatter");

    const productId = matched.productId;
    console.log("✅ Found Mobimatter productId:", productId);

    console.log("📝 Creating Mobimatter order...");
    const createRes = await fetch(`${MOBIMATTER_API_BASE}/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, email }),
    });
    const createJson = await createRes.json();
    const mobimatterOrderId = createJson.result?.orderId;
    if (!mobimatterOrderId) throw new Error("Failed to create Mobimatter order");

    console.log("✅ Mobimatter order created:", mobimatterOrderId);

    // ⏳ Poll for QR readiness (max 10 tries with delay)
    let activation;
    for (let attempt = 1; attempt <= 10; attempt++) {
      console.log(`🔄 Checking QR readiness... attempt ${attempt}`);
      const statusRes = await fetch(`${MOBIMATTER_API_BASE}/order/${mobimatterOrderId}`);
      const statusJson = await statusRes.json();
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!completeRes.ok) {
      throw new Error("Failed to complete Mobimatter order");
    }

    // 📧 Send confirmation email using Mobimatter API
    console.log("📧 Sending confirmation email via Mobimatter...");
    await fetch(`${MOBIMATTER_API_BASE}/order/${mobimatterOrderId}/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

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
