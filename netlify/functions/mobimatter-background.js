const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const getCountryDisplay = (code) => {
  if (!code || code.length !== 2) return `🌐 ${code}`;
  const flag = code
    .toUpperCase()
    .replace(/./g, char => String.fromCodePoint(127397 + char.charCodeAt()));
  const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase());
  return `${flag} ${name || code}`;
};

const getCountryName = (code) => {
  return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase());
};

const getProductDetails = (product) => {
  const details = {};
  (product.productDetails || []).forEach(({ name, value }) => {
    details[name.trim()] = value;
  });
  return details;
};

const normalizeValidity = (value) => {
  if (!value) return "";
  const match = value.match(/(\d+(\.\d+)?)/);
  const num = match ? parseFloat(match[1]) : null;
  if (!num) return value;

  if (/week/i.test(value)) return `${Math.round(num * 7)} Days`;
  if (/month/i.test(value)) return `${Math.round(num * 30)} Days`;
  if (/year/i.test(value)) return `${Math.round(num * 365)} Days`;
  if (/day/i.test(value)) return `${Math.round(num)} Days`;

  return `${Math.round(num)} Days`;
};

const buildDescription = (product, details) => {
  const countries = (product.countries || [])
    .map((c) => `<li>${getCountryDisplay(c)}</li>`) 
    .join("");

  const normalizedValidity = normalizeValidity(details.PLAN_VALIDITY);

  return `
    <div class="esim-description">
      <h3>${details.PLAN_TITLE || product.productFamilyName || "eSIM Plan"}</h3>
      <div class="countries-section">
        <p><strong>Countries:</strong></p>
        <ul>${countries}</ul>
      </div>
      <p><strong>Data:</strong> ${details.PLAN_DATA_LIMIT || "?"} ${details.PLAN_DATA_UNIT || "GB"}</p>
      <p><strong>Validity:</strong> ${normalizedValidity}</p>
      <p><strong>Network:</strong> ${details.FIVEG === "1" ? "📶 5G Supported" : "📱 4G Supported"}</p>
      ${details.SPEED ? `<p><strong>Speed:</strong> ${details.SPEED}</p>` : ""}
      ${details.TOPUP === "1" ? "<p><strong>Top-up:</strong> Available</p>" : ""}
      <p><strong>Calls:</strong> ${details.HAS_CALLS === "1" ? (details.CALL_MINUTES ? `${details.CALL_MINUTES} minutes` : "Available") : "Not available"}</p>
      <p><strong>SMS:</strong> ${details.HAS_SMS === "1" ? (details.SMS_COUNT ? `${details.SMS_COUNT} SMS` : "Available") : "Not available"}</p>
      <p><strong>Price:</strong> $${product.retailPrice?.toFixed(2) || "N/A"}</p>
      <p><strong>Provider:</strong> ${product.providerName || "Mobimatter"}</p>
    </div>
  `;
};

export const handler = async () => {
  const {
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
    SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
    SHOPIFY_API_VERSION = "2025-04",
  } = process.env;

  const MOBIMATTER_API_URL = "https://api.mobimatter.com/mobimatter/api/v2/products";
  const created = [], skipped = [], failed = [];

  try {
    console.log("Fetching from Mobimatter API...");
    const response = await fetch(MOBIMATTER_API_URL, {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
      },
    });

    if (!response.ok) throw new Error(`Mobimatter fetch failed: ${response.status}`);
    const { result: products } = await response.json();
    console.log(`Fetched ${products.length} products`);

    return {
      statusCode: 200,
      body: `Fetched ${products.length} products from Mobimatter.`,
    };
  } catch (err) {
    console.error("Fatal error:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Mobimatter fetch or Shopify sync failed", message: err.message }),
    };
  }
};
