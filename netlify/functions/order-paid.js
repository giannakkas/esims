const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async (event) => {
  console.log("📦 Shopify webhook received.");

  const {
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
  } = process.env;

  // 1. Parse Webhook Body Safely
  let shopifyOrder;
  try {
    if (!event.body) throw new Error("No body provided");
    console.log("📄 Raw body:", event.body);
    shopifyOrder = JSON.parse(event.body);
    console.log("✅ Webhook JSON parsed.");
  } catch (err) {
    console.error("❌ Invalid JSON:", err.message);
    return { statusCode: 400, body: "Invalid JSON" };
  }

  // 2. Extract Needed Info
  const sku = shopifyOrder.line_items?.[0]?.sku;
  const customerEmail = shopifyOrder.email;
  const shopifyOrderId = shopifyOrder.id;

  if (!sku || !customerEmail || !shopifyOrderId) {
    console.error("❌ Missing SKU, email, or order ID.");
    return { statusCode: 400, body: "Missing required order data" };
  }

  console.log("🔍 Extracted:");
  console.log("→ SKU:", sku);
  console.log("→ Email:", customerEmail);
  console.log("→ Shopify Order ID:", shopifyOrderId);

  // 3. Fetch Mobimatter Products
  console.log("🌐 Fetching Mobimatter /v2 products...");
  const productRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/products", {
    headers: {
      "api-key": MOBIMATTER_API_KEY,
      merchantId: MOBIMATTER_MERCHANT_ID,
    },
  });

  const productData = await productRes.json();
  const product = productData?.result?.find(p => p.uniqueId === sku);

  if (!product) {
    console.error("❌ Product not found for SKU:", sku);
    return { statusCode: 404, body: "Product not found in Mobimatter" };
  }

  console.log("✅ Found Mobimatter productId:", product.productId);

  // 4. Create Mobimatter Order
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
    console.error("❌ Failed to create Mobimatter order:", orderJson);
    return { statusCode: 500, body: "Mobimatter order creation failed" };
  }

  console.log("✅ Mobimatter order created:", mobimatterOrderId);

  // 5. Check if QR Code is Ready
  console.log("🔍 Fetching QR code from Mobimatter...");
  const qrRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${mobimatterOrderId}`, {
    headers: {
      "api-key": MOBIMATTER_API_KEY,
      merchantId: MOBIMATTER_MERCHANT_ID,
    },
  });

  const qrJson = await qrRes.json();
  console.log("📦 Full QR JSON:", JSON.stringify(qrJson));

  const activation = qrJson?.result?.activation;
  const imageUrl = activation?.imageUrl;

  if (imageUrl) {
    console.log("✅ QR code ready. Sending Mobimatter confirmation email...");

    const confirmRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/order/send-confirmation", {
      method: "POST",
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ orderId: mobimatterOrderId }),
    });

    console.log("📧 Email send status:", confirmRes.status);
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Order placed and email sent.",
        orderId: mobimatterOrderId,
      }),
    };
  } else {
    console.warn("⏳ QR not ready. Skipping email.");
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Order placed, QR code not ready. Email not sent.",
        orderId: mobimatterOrderId,
      }),
    };
  }
};
