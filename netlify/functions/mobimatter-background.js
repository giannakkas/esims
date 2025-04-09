const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const countryNames = require('./countryNames.json');

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_API_KEY;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-04";
const MOBIMATTER_URL = "https://api.mobimatter.com/mobimatter/api/v2/products";

const getFlagEmoji = (code) =>
  code && code.length === 2
    ? String.fromCodePoint(...[...code.toUpperCase()].map(c => 127397 + c.charCodeAt()))
    : '🌐';

const buildDescription = (product, details) => {
  const countriesList = (product.countries || []).map(code => {
    const flag = getFlagEmoji(code);
    const fullName = countryNames[code] || code;
    return `<li>${flag} ${fullName}</li>`;
  }).join('');

  return `
    <div class="esim-description">
      <h3>${details.PLAN_TITLE || product.productFamilyName || "eSIM Plan"}</h3>
      <div class="countries-section">
        <p><strong>Countries:</strong></p>
        <ul>${countriesList}</ul>
      </div>
      <p><strong>Data:</strong> ${details.PLAN_DATA_LIMIT || "Unlimited"} ${details.PLAN_DATA_UNIT || "GB"}</p>
      <p><strong>Validity:</strong> ${details.PLAN_VALIDITY || "30"} days</p>
      ${details.FIVEG === "1" ? '<p><strong>Network:</strong> 5G Supported</p>' : ''}
      ${details.SPEED ? `<p><strong>Speed:</strong> ${details.SPEED}</p>` : ''}
      ${details.TOPUP === "1" ? '<p><strong>Top-up:</strong> Available</p>' : ''}
      <p><strong>Provider:</strong> ${product.providerName || "Mobimatter"}</p>
    </div>`;
};

exports.handler = async () => {
  const created = [];
  const failed = [];

  try {
    const res = await fetch(MOBIMATTER_URL, {
      headers: {
        "api-key": process.env.MOBIMATTER_API_KEY,
        "merchantId": process.env.MOBIMATTER_MERCHANT_ID,
      }
    });

    if (!res.ok) throw new Error(`Mobimatter API Error: ${res.status}`);
    const { result: products } = await res.json();

    for (const product of products.slice(0, 10)) {
      const details = {};
      (product.productDetails || []).forEach(({ name, value }) => {
        details[name.trim()] = value;
      });

      const price = product.retailPrice?.toFixed(2);
      const title = details.PLAN_TITLE || product.productFamilyName || "eSIM Plan";
      const imageSrc = product.providerLogo;
      const descriptionHtml = buildDescription(product, details);

      const mutation = `
        mutation productCreate($input: ProductInput!) {
          productCreate(input: $input) {
            product { id title }
            userErrors { field message }
          }
        }`;

      const variables = {
        input: {
          title,
          descriptionHtml,
          productType: "eSIM",
          vendor: product.providerName || "Mobimatter",
          status: "ACTIVE",
          published: true,
          tags: [
            details.FIVEG === "1" ? "5G" : "4G",
            `data-${details.PLAN_DATA_LIMIT || "unlimited"}${details.PLAN_DATA_UNIT || "GB"}`,
            ...(product.countries || []).map(c => `country-${c}`)
          ],
          variants: price
            ? [{
                price,
                sku: product.productId,
                inventoryManagement: "SHOPIFY",
                inventoryPolicy: "CONTINUE",
                inventoryQuantity: 999999
              }]
            : undefined,
          images: imageSrc ? [{ src: imageSrc }] : undefined
        }
      };

      const shopifyRes = await fetch(
        `https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_TOKEN,
          },
          body: JSON.stringify({ query: mutation, variables })
        }
      );

      const shopifyJson = await shopifyRes.json();
      const errors = shopifyJson?.data?.productCreate?.userErrors;

      if (errors?.length) {
        failed.push({ title, reason: errors.map(e => e.message).join(", ") });
      } else {
        created.push(title);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Created ${created.length} product(s)`,
        created,
        failed
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Mobimatter fetch or Shopify sync failed",
        message: err.message
      })
    };
  }
};
