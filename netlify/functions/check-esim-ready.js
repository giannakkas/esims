const fs = require("fs");
const path = require("path");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

const PENDING_PATH = path.join("/tmp", "pending-orders.json");

exports.handler = async () => {
  console.log("🔁 Running eSIM QR background checker...");

  const {
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
    SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
    SHOPIFY_API_VERSION = "2025-04",
  } = process.env;

  let pending = [];
  if (fs.existsSync(PENDING_PATH)) {
    pending = JSON.parse(fs.readFileSync(PENDING_PATH, "utf-8"));
  }

  if (pending.length === 0) {
    console.log("📭 No pending eSIM orders.");
    return { statusCode: 200, body: "No pending orders." };
  }

  const stillPending = [];

  for (const entry of pending) {
    const { mobimatterOrderId, shopifyOrderId, customerEmail } = entry;

    console.log(`📦 Checking Mobimatter order: ${mobimatterOrderId}`);

    const res = await fetch(`https://api.mobimatter.com/mobimatter/api/v2/order/${mobimatterOrderId}`, {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
      },
    });

    let result;
    try {
      result = await res.json();
    } catch (err) {
      console.error("❌ Failed to parse JSON from Mobimatter:", err.message);
      stillPending.push(entry);
      continue;
    }

    const activation = result?.result?.activation;
    const imageUrl = activation?.imageUrl;
    const lpa = activation?.lpa;

    if (!imageUrl) {
      console.log("⏳ QR code not ready yet. Will retry later.");
      stillPending.push(entry);
      continue;
    }

    console.log("✅ QR code found! Updating Shopify...");

    // Add order note with QR code
    const note = `
      eSIM Activation QR Code for Mobimatter Order ${mobimatterOrderId}:

      ![QR Code](${imageUrl})

      ${lpa ? `LPA Code: ${lpa}` : ""}
    `;

    const updateRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/orders/${shopifyOrderId}.json`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
      },
      body: JSON.stringify({
        order: {
          id: shopifyOrderId,
          note,
        },
      }),
    });

    const updateText = await updateRes.text();
    console.log("📝 Shopify order updated with QR code.");
  }

  // Save updated pending list
  fs.writeFileSync(PENDING_PATH, JSON.stringify(stillPending, null, 2));
  console.log(`✅ Finished check. ${stillPending.length} orders still pending.`);

  return {
    statusCode: 200,
    body: JSON.stringify({ processed: pending.length - stillPending.length, stillPending: stillPending.length }),
  };
};
