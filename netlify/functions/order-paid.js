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
    const lineItem = shopifyOrder.line_items?.[0];
    const sku = lineItem?.sku;
    const customerEmail = shopifyOrder.email;
    const orderId = shopifyOrder.id;

    console.log("🔍 Extracted values:");
    console.log("   → SKU (Mobimatter uniqueId):", sku);
    console.log("   → Customer Email:", customerEmail);
    console.log("   → Shopify Order ID:", orderId);

    if (!sku || !customerEmail || !orderId) {
      throw new Error("Missing SKU, email, or order ID in webhook payload.");
    }

    // 2. Fetch product list from Mobimatter /v1
    console.log("🌐 Fetching Mobimatter /v1 products...");
    const productsRes = await fetch("https://api.mobimatter.com/mobimatter/api/v1/products", {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
      },
    });

    const rawText = await productsRes.text();

    if (!rawText || rawText.trim() === "") {
      throw new Error("Mobimatter /v1/products responded with empty body.");
    }

    let productsJson;
    try {
      productsJson = JSON.parse(rawText);
    } catch (err) {
      console.error("❌ Failed to parse Mobimatter /v1/products JSON:", rawText);
      throw new Error("Mobimatter /v1/products response is not valid JSON");
    }

    const products = productsJson?.result;
    if (!Array.isArray(products)) {
      throw new Error("Invalid product list from Mobimatter /v1/products");
    }

    const product = products.find((p) => p.uniqueId === sku || p.id === sku);
    if (!product) {
      throw new Error(`No matching product found for SKU: ${sku}`);
    }

    console.log("🔎 Matched Mobimatter product:");
    console.log(JSON.stringify(product, null, 2));

    const productId = product.id;
    if (!productId) {
      throw new Error("Matched product is missing internal 'id'");
    }

    console.log("✅ Using internal productId:", productId);

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
        productId,
        quantity: 1,
        customerEmail,
      }),
    });

    console.log("   → Mobimatter response status:", createRes.status);
    const createText = await createRes.text();
    if (!createText || createText.trim() === "") {
      throw new Error(`Mobimatter responded with empty body. Status: ${createRes.status}`);
    }

    let createData;
    try {
      createData = JSON.parse(createText);
    } catch (err) {
      console.error("❌ Failed to parse Mobimatter create order response:", createText);
      throw new Error("Mobimatter create order response is not valid JSON");
    }

    const mobimatterOrderId = createData?.result?.orderId;
    if (!mobimatterOrderId) {
      throw new Error("Mobimatter did not return an orderId.");
    }

    console.log("✅ Mobimatter order created:", mobimatterOrderId);

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

    const completeText = await completeRes.text();
    console.log("   → Mobimatter complete response:", completeText);
    console.log("✅ Mobimatter order completed");

    // 5. Fetch QR Code
    console.log("🔍 Fetching activation QR code...");
    const qrRes = await fetch(`https://api.mobimatter.com/mobimatter/api/v1/order/${mobimatterOrderId}`, {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
      },
    });

    const qrText = await qrRes.text();
    let qrData;
    try {
      qrData = JSON.parse(qrText);
    } catch (err) {
      console.error("❌ Failed to parse QR code response:", qrText);
      throw new Error("QR code response is not valid JSON");
    }

    const qrUrl = qrData?.result?.activation?.imageUrl;
    if (!qrUrl) {
      throw new Error("QR code imageUrl not found in Mobimatter response.");
    }

    console.log("🖼 QR code URL:", qrUrl);

    // 6. Add QR code to Shopify order note
    console.log("📝 Updating Shopify order note...");
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
    console.log("✅ Shopify order note updated.");

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Order completed, QR code added to note.",
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
