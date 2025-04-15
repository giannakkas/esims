const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

exports.handler = async (event) => {
  const {
    SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
  } = process.env;

  console.log("📦 Shopify webhook received.");

  // 1. Parse webhook payload safely
  let shopifyOrder;
  try {
    shopifyOrder = JSON.parse(event.body);
    console.log("✅ Webhook JSON parsed successfully.");
  } catch (parseError) {
    console.error("❌ Failed to parse webhook body. Raw body:", event.body);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid JSON in webhook body" }),
    };
  }

  try {
    // 2. Extract required fields from the order
    const lineItem = shopifyOrder.line_items?.[0];
    const sku = lineItem?.sku;
    const customerEmail = shopifyOrder.email;
    const orderId = shopifyOrder.id;

    console.log("🔍 Extracted values:");
    console.log("   → SKU:", sku);
    console.log("   → Customer Email:", customerEmail);
    console.log("   → Shopify Order ID:", orderId);

    if (!sku || !customerEmail || !orderId) {
      throw new Error("Missing SKU, email, or order ID in webhook payload.");
    }

    // 3. Create Mobimatter order
    console.log("📝 Creating Mobimatter order...");
    const createRes = await fetch("https://api.mobimatter.com/mobimatter/api/v1/order", {
      method: "POST",
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        productId: sku,
        quantity: 1,
        customerEmail,
      }),
    });

    const createData = await createRes.json();
    const mobimatterOrderId = createData?.result?.orderId;

    console.log("   → Mobimatter create response:", JSON.stringify(createData, null, 2));

    if (!mobimatterOrderId) {
      throw new Error("Failed to create Mobimatter order. No orderId returned.");
    }

    console.log(`✅ Mobimatter order created: ${mobimatterOrderId}`);

    // 4. Complete Mobimatter order
    console.log("🔄 Completing Mobimatter order...");
    const completeRes = await fetch("https://api.mobimatter.com/mobimatter/api/v1/order/complete", {
      method: "POST",
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ orderId: mobimatterOrderId }),
    });

    const completeJson = await completeRes.json();
    console.log("   → Mobimatter complete response:", JSON.stringify(completeJson, null, 2));

    console.log("✅ Mobimatter order completed.");

    // 5. Fetch QR code
    console.log("🔍 Fetching activation QR code...");
    const qrRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v1/order/${mobimatterOrderId}`, {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
      },
    });

    const qrData = await qrRes.json();
    console.log("   → QR data response:", JSON.stringify(qrData, null, 2));

    const qrUrl = qrData?.result?.activation?.imageUrl;
    if (!qrUrl) {
      throw new Error("QR code image URL not found in Mobimatter response.");
    }

    console.log(`🖼 QR code URL retrieved: ${qrUrl}`);

    // 6. Add QR to Shopify order note
    console.log("📝 Updating Shopify order note with QR code...");

    const noteRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-04/orders/${orderId}.json`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
      },
      body: JSON.stringify({
        order: {
          id: orderId,
          note: `✅ Your eSIM is ready!\nScan this QR Code to activate:\n${qrUrl}`,
        },
      }),
    });

    const noteJson = await noteRes.json();
    console.log("✅ Shopify order note updated successfully.");
    console.log("   → Final note:", noteJson?.order?.note);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "QR code generated and added to order note.",
        qrUrl,
      }),
    };
  } catch (error) {
    console.error("❌ Error in order-paid handler:", error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
