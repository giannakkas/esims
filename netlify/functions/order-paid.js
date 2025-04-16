const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

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

    // === Validate API credentials ===
    if (!MOBIMATTER_API_KEY || !MOBIMATTER_MERCHANT_ID) {
      console.error("❌ Missing API credentials in environment variables");
      return {
        statusCode: 500,
        body: "Missing Mobimatter API credentials",
      };
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

    const lineItem = lineItems[0]; // Assuming one eSIM per order
    const productId = lineItem.sku;

    console.log("🔎 Extracted product ID from SKU:", productId);
    console.log("🧾 Line item title:", lineItem.title);

    if (!productId) {
      console.error("❌ Missing productUniqueId (SKU) in the order");
      return {
        statusCode: 400,
        body: "Missing productUniqueId (SKU) in order item",
      };
    }

    // === 1. Create Mobimatter Order ===
    console.log("📡 Creating Mobimatter order...");

    const createOrderRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": MOBIMATTER_API_KEY,
        "merchantId": MOBIMATTER_MERCHANT_ID,
      },
      body: JSON.stringify({
        productUniqueId: productId,
        customerEmail: email,
      }),
    });

    const createOrderData = await createOrderRes.json();
    console.log("📥 Mobimatter createOrder response:", createOrderData);

    if (!createOrderRes.ok || !createOrderData?.orderId) {
      console.error("❌ Mobimatter order creation failed:", createOrderData);
      return {
        statusCode: 500,
        body: "Mobimatter order creation failed",
      };
    }

    const orderId = createOrderData.orderId;
    console.log("✅ Created Mobimatter order:", orderId);

    // === 2. Complete Mobimatter Order ===
    console.log("📡 Completing Mobimatter order...");

    const completeRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${orderId}/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": MOBIMATTER_API_KEY,
        "merchantId": MOBIMATTER_MERCHANT_ID,
      },
    });

    if (!completeRes.ok) {
      const errText = await completeRes.text();
      console.error(`❌ Failed to complete order ${orderId}:`, errText);
      return {
        statusCode: 500,
        body: "Mobimatter order completion failed",
      };
    }

    console.log("✅ Completed Mobimatter order:", orderId);

    // === 3. Send Confirmation Email ===
    console.log("📧 Sending confirmation email to customer...");

    const sendEmailRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/order/send-order-confirmation-to-customer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": MOBIMATTER_API_KEY,
        "merchantId": MOBIMATTER_MERCHANT_ID,
      },
      body: JSON.stringify({
        orderId,
        customerEmail: email,
      }),
    });

    const sendEmailData = await sendEmailRes.json();
    console.log("📥 Mobimatter email send response:", sendEmailData);

    if (!sendEmailRes.ok) {
      console.error("❌ Failed to send confirmation email:", sendEmailData);
      return {
        statusCode: 500,
        body: "Mobimatter email send failed",
      };
    }

    console.log("✅ eSIM confirmation email sent to:", email);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "eSIM sent to customer", orderId }),
    };

  } catch (err) {
    console.error("❌ Uncaught error:", err);
    return {
      statusCode: 500,
      body: "Unexpected error occurred",
    };
  }
};
