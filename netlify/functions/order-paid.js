const fs = require("fs");
const path = require("path");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

const PENDING_PATH = path.join("/tmp", "pending-orders.json");

function savePendingOrder(entry) {
  try {
    let data = [];
    if (fs.existsSync(PENDING_PATH)) {
      data = JSON.parse(fs.readFileSync(PENDING_PATH, "utf-8"));
    }
    data.push(entry);
    fs.writeFileSync(PENDING_PATH, JSON.stringify(data, null, 2));
    console.log("📝 Saved to pending orders:", entry);
  } catch (err) {
    console.error("❌ Failed to save pending order:", err.message);
  }
}

exports.handler = async (event) => {
  console.log("📦 Shopify webhook received.");

  const {
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
  } = process.env;

  let shopifyOrder;
  try {
    shopifyOrder = JSON.parse(event.body);
    console.log("✅ Webhook JSON parsed successfully.");
  } catch (err) {
    console.error("❌ Invalid JSON in webhook:", err.message);
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const lineItem = shopifyOrder.line_items?.[0];
  const sku = lineItem?.sku;
  const customerEmail = shopifyOrder.email;
  const shopifyOrderId = shopifyOrder.id;

  if (!sku || !customerEmail || !shopifyOrderId) {
    console.error("❌ Missing SKU, email, or order ID.");
    return { statusCode: 400, body: "Missing required data" };
  }

  console.log("🔍 Extracted values:");
  console.log("   → SKU:", sku);
  console.log("   → Email:", customerEmail);
  console.log("   → Shopify Order ID:", shopifyOrderId);

  // Fetch Mobimatter products
  console.log("🌐 Fetching Mobimatter products...");
  const productRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/products", {
    headers: {
      "api-key": MOBIMATTER_API_KEY,
      merchantId: MOBIMATTER_MERCHANT_ID,
    },
  });

  const data = await productRes.json();
  const products = data?.result || [];

  const product = products.find((p) => p.uniqueId === sku);
  if (!product) {
    console.error("❌ Product with SKU not found in Mobimatter.");
    return { statusCode: 404, body: "Product not found" };
  }

  console.log("✅ Found Mobimatter product:", product.productId);

  // Create Mobimatter order
  console.log("📝 Creating Mobimatter order...");
  const orderRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/order", {
    method: "POST",
    headers: {
      "api-key": MOBIMATTER_API_KEY,
      merchantId: MOBIMATTER_MERCHANT_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      productId: product.productId,
      quantity: 1,
      customerEmail,
    }),
  });

  const text = await orderRes.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch (err) {
    console.error("❌ Invalid response from Mobimatter /v2/order:", text);
    return { statusCode: 500, body: "Mobimatter order creation failed" };
  }

  const mobimatterOrderId = result?.result?.orderId;
  if (!mobimatterOrderId) {
    console.error("❌ Mobimatter orderId missing in response.");
    return { statusCode: 500, body: "Order ID missing from Mobimatter response" };
  }

  console.log("✅ Mobimatter order created:", mobimatterOrderId);

  // Save to pending order list (for background QR check)
  savePendingOrder({
    mobimatterOrderId,
    shopifyOrderId,
    customerEmail,
    sku,
    createdAt: new Date().toISOString(),
  });

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "Mobimatter order created. QR will be processed in background.",
      mobimatterOrderId,
    }),
  };
};
