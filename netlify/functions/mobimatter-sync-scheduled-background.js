const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const getCountryDisplay = (code) => {
  if (!code || code.length !== 2) return `🌐 ${code}`;
  const flag = code
    .toUpperCase()
    .replace(/./g, char => String.fromCodePoint(127397 + char.charCodeAt()));
  const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase());
  return `${flag} ${name || code}`;
};

const getProductDetails = (product) => {
  const details = {};
  (product.productDetails || []).forEach(({ name, value }) => {
    details[name.trim()] = value;
  });
  return details;
};

const buildDescription = (product, details) => {
  const countries = (product.countries || [])
    .map((c) => `<li>${getCountryDisplay(c)}</li>`)
    .join("");

  const rawValidity = details.PLAN_VALIDITY || "";
  const validityInDays = /^\d+$/.test(rawValidity)
    ? `${parseInt(rawValidity) / 24} days`
    : rawValidity;

  const mobimatterDescription = product.description
    ? `<div class="mobimatter-description"><hr />${product.description}</div>`
    : "";

  return `
    <div class="esim-description">
      <h3>${details.PLAN_TITLE || product.productFamilyName || "eSIM Plan"}</h3>
      <div class="countries-section">
        <p><strong>Countries:</strong></p>
        <ul>${countries}</ul>
      </div>
      <p><strong>Data:</strong> ${details.PLAN_DATA_LIMIT || "?"} ${details.PLAN_DATA_UNIT || "GB"}</p>
      <p><strong>Validity:</strong> ${validityInDays}</p>
      <p><strong>Network:</strong> ${details.FIVEG === "1" ? "📶 5G Supported" : "📱 4G Supported"}</p>
      ${details.SPEED ? `<p><strong>Speed:</strong> ${details.SPEED}</p>` : ""}
      ${details.TOPUP === "1" ? "<p><strong>Top-up:</strong> Available</p>" : ""}
      <p><strong>Calls:</strong> ${details.HAS_CALLS === "1" ? (details.CALL_MINUTES ? `${details.CALL_MINUTES} minutes` : "Available") : "Not available"}</p>
      <p><strong>SMS:</strong> ${details.HAS_SMS === "1" ? (details.SMS_COUNT ? `${details.SMS_COUNT} SMS` : "Available") : "Not available"}</p>
      <p><strong>Price:</strong> $${product.retailPrice?.toFixed(2) || "N/A"}</p>
      <p><strong>Provider:</strong> ${product.providerName || "Mobimatter"}</p>
    </div>
    ${mobimatterDescription}
  `;
};

exports.handler = async (event) => {
  console.log("✅ Function started");

  if (event.httpMethod !== "POST" && event.headers["x-scheduled-function"] !== "true") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
    SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
    SHOPIFY_API_VERSION;

  try {
    console.log("🧪 Checking environment variables...");

    MOBIMATTER_API_KEY = process.env.MOBIMATTER_API_KEY;
    console.log("✅ MOBIMATTER_API_KEY loaded");

    MOBIMATTER_MERCHANT_ID = process.env.MOBIMATTER_MERCHANT_ID;
    console.log("✅ MOBIMATTER_MERCHANT_ID loaded");

    SHOPIFY_ADMIN_API_KEY = process.env.SHOPIFY_ADMIN_API_KEY;
    console.log("✅ SHOPIFY_ADMIN_API_KEY loaded");

    SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
    console.log("✅ SHOPIFY_STORE_DOMAIN loaded");

    SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-04";
    console.log("✅ SHOPIFY_API_VERSION loaded");

    console.log("🔍 ENV CHECK COMPLETE");
  } catch (err) {
    console.error("❌ ENV ERROR", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to read environment variables", detail: err.message }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Environment loaded. Ready to proceed." }),
  };
};
