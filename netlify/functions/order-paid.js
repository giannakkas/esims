const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

exports.handler = async (event) => {
  const {
    SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
  } = process.env;

  console.log("📦 Shopify webhook received.");

  let shopifyOrder;
  try {
    shopifyOrder = JSON.parse(event.body);
    console.log("✅ Webhook JSON parsed successfully.");
  } catch (err) {
    console.error("❌ Failed to parse webhook body:", err.message);
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

    // 🔄 Fetch products from /v2/products
    console.log("🌐 Fetching Mobimatter /v2 products...");
    const productsRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/products", {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
      },
    });

    const productsData = await productsRes.json();
    const products = productsData?.result;

    if (!Array.isArray(products)) {
      throw new Error("Invalid product list from Mobimatter /v2/products");
    }

    const product = products.find((p) => p.uniqueId === sku);
    if (!product) {
      throw new Error(`No matching product found for SKU: ${sku}`);
    }

    const productId = product.productId;
    if (!productId) {
      throw new Error("Product found, but productId is missing");
    }

    console.log("✅ Found Mobimatter productId:", productId);

    // 📝 Create Mobimatter order via /v2/order
    console.log("📝 Creating Mobimatter order via /v2...");
    const createOrderRes = await fetch("https://api.mobimatter.com/mobimatter/api/v2/order", {
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

    const createText = await createOrderRes.text();
    if (!createText || createText.trim() === "") {
      throw new Error(`Mobimatter /v2/order returned empty response. Status: ${createOrderRes.status}`);
    }

    let createData;
    try {
      createData = JSON.parse(createText);
    } catch (err) {
      console.error("❌ Failed to parse /v2/order response:", createText);
      throw new Error("Invalid JSON from Mobimatter /v2/order");
    }

    const mobimatterOrderId = createData?.result?.orderId;
    if (!mobimatterOrderId) {
      throw new Error("No orderId returned from Mobimatter /v2/order");
    }

    console.log("✅ Mobimatter order created:", mobimatterOrderId);

    // ✅ Order complete by default — now retrieve QR
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
      console.error("❌ Failed to parse QR response:", qrText);
      throw new Error("Invalid JSON from QR code fetch");
    }

    const qrUrl = qrData?.result?.activation?.imageUrl;
    if (!qrUrl) {
      throw new Error("QR code imageUrl not found in response");
    }

    console.log("🖼 QR code URL:", qrUrl);

    // 📝 Add QR code to Shopify order note
    console.log("✍️ Updating Shopify order note...");
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
      body: JSON.stringify({ message: "Order processed and QR code added.", qrUrl }),
    };
  } catch (error) {
    console.error("❌ Error in order-paid handler:", error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
