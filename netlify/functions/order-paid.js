const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

exports.handler = async (event) => {
  const {
    SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
  } = process.env;

  try {
    // 1. Parse Shopify order
    const shopifyOrder = JSON.parse(event.body);
    const lineItem = shopifyOrder.line_items?.[0];
    const sku = lineItem?.sku; // Mobimatter productId is stored as SKU
    const customerEmail = shopifyOrder.email;
    const orderId = shopifyOrder.id;

    if (!sku || !customerEmail) {
      throw new Error("Missing SKU or customer email");
    }

    // 2. Create Mobimatter order
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
        customerEmail: customerEmail,
      }),
    });

    const createData = await createRes.json();
    const mobimatterOrderId = createData?.result?.orderId;
    if (!mobimatterOrderId) {
      throw new Error("Failed to create Mobimatter order");
    }

    // 3. Complete Mobimatter order
    await fetch("https://api.mobimatter.com/mobimatter/api/v1/order/complete", {
      method: "POST",
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ orderId: mobimatterOrderId }),
    });

    // 4. Get QR Code
    const qrRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v1/order/${mobimatterOrderId}`, {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
      },
    });

    const qrData = await qrRes.json();
    const qrUrl = qrData?.result?.activation?.imageUrl;

    if (!qrUrl) throw new Error("QR code not available");

    // 5. Add QR code as order note in Shopify
    const shopifyRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-04/orders/${orderId}.json`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
      },
      body: JSON.stringify({
        order: {
          id: orderId,
          note: `Your eSIM QR Code: ${qrUrl}`,
        },
      }),
    });

    const shopifyJson = await shopifyRes.json();

    console.log("✅ QR code added to order note.");

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "QR code generated and added to order note", qrUrl }),
    };
  } catch (error) {
    console.error("❌ Error in order-paid handler:", error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
