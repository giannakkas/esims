const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async (event) => {
  console.log("📦 Shopify webhook received.");

  const {
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
  } = process.env;

  let shopifyOrder;
  try {
    shopifyOrder = JSON.parse(event.body);
    console.log("✅ Webhook JSON parsed.");
  } catch (err) {
    console.error("❌ Invalid JSON:", err.message);
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const sku = shopifyOrder.line_items?.[0]?.sku;
  const customerEmail = shopifyOrder.email;
  const shopifyOrderId = shopifyOrder.id;

  if (!sku || !customerEmail || !shopifyOrderId) {
    console.error("❌ Missing SKU, email or order ID.");
    return { statusCode: 400, body: "Missing required info" };
  }

  console.log("🔍 SKU:", sku);
  console.log("📧 Email:", customerEmail);
  console.log("🛍️ Shopify Order ID:", shopifyOrderId);

  // Fetch Mobimatter products
  console.log("🌐 Fetching Mobimatter products...");
  const productRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/products", {
    headers: {
      "api-key": MOBIMATTER_API_KEY,
      merchantId: MOBIMATTER_MERCHANT_ID,
    },
  });

  const data = await productRes.json();
  const product = data?.result?.find(p => p.uniqueId === sku);

  if (!product) {
    console.error("❌ Product not found in Mobimatter.");
    return { statusCode: 404, body: "Product not found" };
  }

  console.log("✅ Found Mobimatter productId:", product.productId);

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

  const orderJson = await orderRes.json();
  const mobimatterOrderId = orderJson?.result?.orderId;

  if (!mobimatterOrderId) {
    console.error("❌ Mobimatter order creation failed:", orderJson);
    return { statusCode: 500, body: "Mobimatter order failed" };
  }

  console.log("✅ Mobimatter order created:", mobimatterOrderId);

  // Try to fetch activation info immediately
  console.log("🔍 Checking QR code...");
  const qrRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${mobimatterOrderId}`, {
    headers: {
      "api-key": MOBIMATTER_API_KEY,
      merchantId: MOBIMATTER_MERCHANT_ID,
    },
  });

  const qrJson = await qrRes.json();
  const activation = qrJson?.result?.activation;
  const imageUrl = activation?.imageUrl;

  if (imageUrl) {
    console.log("✅ QR code is ready. Sending Mobimatter confirmation email...");

    const confirmRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/order/send-confirmation", {
      method: "POST",
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ orderId: mobimatterOrderId }),
    });

    const confirmStatus = confirmRes.status;
    console.log(`📧 Email send status: ${confirmStatus}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Order created and confirmation email sent.",
        orderId: mobimatterOrderId,
      }),
    };
  } else {
    console.warn("⏳ QR not ready yet. Mobimatter won't send email now.");
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Order created, but QR code not ready yet. Email not sent.",
        orderId: mobimatterOrderId,
      }),
    };
  }
};
