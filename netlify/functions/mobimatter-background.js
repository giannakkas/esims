const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const COUNTRY_NAMES = require('./countryNames.json'); // you’ll create this file
const FLAG_EMOJIS = require('./flagEmojis.json');     // and this one too

exports.handler = async function () {
  const {
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
    SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
    SHOPIFY_API_VERSION = "2025-04",
  } = process.env;

  const created = [];
  const failed = [];

  try {
    const response = await fetch("https://api.mobimatter.com/mobimatter/api/v2/products", {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        "merchantId": MOBIMATTER_MERCHANT_ID
      }
    });

    if (!response.ok) throw new Error(`Mobimatter fetch failed: ${response.status}`);
    const { result: products } = await response.json();

    for (const product of products.slice(0, 10)) {
      try {
        const details = {};
        (product.productDetails || []).forEach(({ name, value }) => {
          details[name.trim()] = value;
        });

        const title = details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM";
        const price = product.retailPrice?.toFixed(2);
        const flagList = (product.countries || []).map(code => {
          const flag = FLAG_EMOJIS[code] || '🌐';
          const name = COUNTRY_NAMES[code] || code;
          return `<li>${flag} ${name}</li>`;
        }).join("");

        const bodyHtml = `
          <div class="esim-description">
            <h3>${title}</h3>
            <div class="countries-section">
              <p><strong>Countries:</strong></p>
              <ul>${flagList}</ul>
            </div>
            <p><strong>Data:</strong> ${details.PLAN_DATA_LIMIT || "Unlimited"} ${details.PLAN_DATA_UNIT || "GB"}</p>
            <p><strong>Validity:</strong> ${details.PLAN_VALIDITY || "?"} days</p>
            ${details.FIVEG === "1" ? "<p><strong>Network:</strong> 5G Supported</p>" : ""}
            ${details.SPEED ? `<p><strong>Speed:</strong> ${details.SPEED}</p>` : ""}
            <p><strong>Provider:</strong> ${product.providerName}</p>
          </div>
        `;

        const mutation = `
          mutation productCreate($input: ProductInput!) {
            productCreate(input: $input) {
              product { id title }
              userErrors { field message }
            }
          }
        `;

        const variables = {
          input: {
            title,
            descriptionHtml: bodyHtml,
            vendor: product.providerName || "Mobimatter",
            productType: "eSIM",
            tags: [
              details.FIVEG === "1" ? "5G" : "4G",
              `data-${details.PLAN_DATA_LIMIT || "unlimited"}${details.PLAN_DATA_UNIT || "GB"}`,
              ...(product.countries || []).map(c => `country-${c}`)
            ],
            status: "ACTIVE",
            published: true, // Publish to all sales channels
            images: product.providerLogo ? [{ src: product.providerLogo }] : undefined,
            variants: [
              {
                price,
                sku: product.uniqueId,
                inventoryQuantity: 999999,
                fulfillmentService: "manual",
                inventoryManagement: null,
                taxable: true
              }
            ]
          }
        };

        const shopifyRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
          },
          body: JSON.stringify({ query: mutation, variables })
        });

        const shopifyJson = await shopifyRes.json();
        const errors = shopifyJson?.data?.productCreate?.userErrors;

        if (errors?.length) {
          failed.push({ title, reason: errors.map(e => e.message).join(", ") });
        } else {
          created.push(title);
        }

      } catch (err) {
        failed.push({ title: product.productFamilyName || "Unnamed", reason: err.message });
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Created ${created.length} product(s)`, created, failed })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Mobimatter fetch or Shopify sync failed", message: err.message })
    };
  }
};
