// netlify/functions/order-paid.js
const fetch = require("node-fetch");

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
    const productsRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/products");
    const products = await productsRes.json();

    const matched = products.find((p) => p.uniqueId === sku);
    if (!matched) {
      throw new Error("Product not found in Mobimatter");
    }

    const productId = matched.productId;
    console.log("✅ Found Mobimatter productId:", productId);

    console.log("📝 Creating Mobimatter order...");
    const orderRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, email }),
    });

    const orderJson = await orderRes.json();
    const mobimatterOrderId = orderJson.result?.orderId;

    if (!mobimatterOrderId) {
      throw new Error("Failed to create Mobimatter order");
    }

    console.log("✅ Mobimatter order created:", mobimatterOrderId);
    console.log("📩 Starting QR readiness background check...");

    await fetch(`${process.env.URL}/.netlify/functions/check-esim-ready`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: mobimatterOrderId,
        customerEmail: email,
      }),
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
