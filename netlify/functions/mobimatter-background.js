const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Country code to name and emoji
const COUNTRY_INFO = {
  ME: { name: "Montenegro", flag: "🇲🇪" },
  RS: { name: "Serbia", flag: "🇷🇸" },
  VN: { name: "Vietnam", flag: "🇻🇳" },
  BG: { name: "Bulgaria", flag: "🇧🇬" },
  ID: { name: "Indonesia", flag: "🇮🇩" },
  FR: { name: "France", flag: "🇫🇷" },
  JP: { name: "Japan", flag: "🇯🇵" },
  TH: { name: "Thailand", flag: "🇹🇭" },
  US: { name: "United States", flag: "🇺🇸" },
  CA: { name: "Canada", flag: "🇨🇦" },
  GB: { name: "United Kingdom", flag: "🇬🇧" },
  // Add more countries as needed
};

exports.handler = async () => {
  const {
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
    SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
    SHOPIFY_API_VERSION = "2025-04",
  } = process.env;

  const MOBIMATTER_URL = "https://api.mobimatter.com/mobimatter/api/v2/products";

  const created = [];
  const failed = [];

  try {
    const response = await fetch(MOBIMATTER_URL, {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        "merchantId": MOBIMATTER_MERCHANT_ID,
      },
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
        const price = parseFloat(product.retailPrice)?.toFixed(2);
        const countriesHtml = (product.countries || []).map(code => {
          const info = COUNTRY_INFO[code] || { name: code, flag: "🌐" };
          return `<li>${info.flag} ${info.name}</li>`;
        }).join("");

        const descriptionHtml = `
          <div class="esim-description">
            <h3>${title}</h3>
            <div class="countries-section">
              <p><strong>Countries:</strong></p>
              <ul>${countriesHtml}</ul>
            </div>
            <p><strong>Data:</strong> ${details.PLAN_DATA_LIMIT || "?"} ${details.PLAN_DATA_UNIT || "GB"}</p>
            <p><strong>Validity:</strong> ${details.PLAN_VALIDITY || "?"} days</p>
            ${details.FIVEG === "1" ? `<p><strong>Network:</strong> 5G Supported</p>` : ""}
            ${details.SPEED ? `<p><strong>Speed:</strong> ${details.SPEED}</p>` : ""}
            <p><strong>Provider:</strong> ${product.providerName || "Mobimatter"}</p>
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
            descriptionHtml,
            vendor: product.providerName || "Mobimatter",
            productType: "eSIM",
            tags: [
              details.FIVEG === "1" ? "5G" : "4G",
              `data-${details.PLAN_DATA_LIMIT || "?"}${details.PLAN_DATA_UNIT || "GB"}`,
              ...(product.countries || []).map(c => `country-${c}`)
            ],
            status: "ACTIVE"
          }
        };

        const res = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
          },
          body: JSON.stringify({ query: mutation, variables }),
        });

        const json = await res.json();
        const errors = json?.data?.productCreate?.userErrors;

        if (!res.ok || (errors && errors.length)) {
          failed.push({ title, reason: errors.map(e => e.message).join(", ") });
        } else {
          created.push(title);
        }
      } catch (err) {
        failed.push({ title: product.productFamilyName || "Unknown", reason: err.message });
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Created ${created.length} product(s)`, created, failed }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Mobimatter fetch or Shopify sync failed", message: err.message }),
    };
  }
};
