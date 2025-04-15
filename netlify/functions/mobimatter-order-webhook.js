const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async (event) => {
  const {
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
    SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
    SHOPIFY_API_VERSION = '2025-04',
  } = process.env;

  try {
    const body = JSON.parse(event.body);
    const orderId = body.id;
    const email = body.email;
    const lineItems = body.line_items;

    console.log("📦 New paid order received:", orderId);

    // Loop through line items and trigger Mobimatter order creation
    for (const item of lineItems) {
      const productId = item.sku || item.variant_id; // Use SKU as identifier
      const quantity = item.quantity;

      // 1. Create Mobimatter order
      const createRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": MOBIMATTER_API_KEY,
          "merchantId": MOBIMATTER_MERCHANT_ID,
        },
        body: JSON.stringify({
          productId,
          quantity,
          deliveryMethod: "EMAIL",
          deliveryAddress: email,
        }),
      });

      const createData = await createRes.json();
      const { orderId: mobimatterOrderId } = createData.result || {};

      if (!mobimatterOrderId) {
        console.error("❌ Failed to create Mobimatter order:", createData);
        continue;
      }

      console.log("🧾 Mobimatter order created:", mobimatterOrderId);

      // 2. Complete Mobimatter order
      await fetch(`https://api.mobimatter.com/mobimatter/api/v2/orders/${mobimatterOrderId}/complete`, {
        method: "POST",
        headers: {
          "api-key": MOBIMATTER_API_KEY,
          "merchantId": MOBIMATTER_MERCHANT_ID,
        },
      });

      console.log("✅ Mobimatter order completed");

      // 3. Get QR code
      const getRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/orders/${mobimatterOrderId}`, {
        headers: {
          "api-key": MOBIMATTER_API_KEY,
          "merchantId": MOBIMATTER_MERCHANT_ID,
        },
      });

      const getData = await getRes.json();
      const qrCodeUrl = getData.result?.eSimDetails?.qrCodeUrl;

      if (!qrCodeUrl) {
        console.error("❌ QR code not found:", getData);
        continue;
      }

      console.log("📲 QR code fetched:", qrCodeUrl);

      // 4. Save QR code to Shopify order metafield
      await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/orders/${orderId}/metafields.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
        },
        body: JSON.stringify({
          metafield: {
            namespace: "custom",
            key: "qr_code",
            value: qrCodeUrl,
            type: "single_line_text_field"
          },
        }),
      });

      console.log("💾 QR code saved to order:", orderId);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error("🔥 Webhook error:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
