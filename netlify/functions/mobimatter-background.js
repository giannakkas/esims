const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Country codes to full names with flags
const countryMap = {
  "ME": "🇲🇪 Montenegro",
  "RS": "🇷🇸 Serbia",
  "VN": "🇻🇳 Vietnam",
  "BG": "🇧🇬 Bulgaria",
  "ID": "🇮🇩 Indonesia",
  "FR": "🇫🇷 France",
  "JP": "🇯🇵 Japan",
  "TH": "🇹🇭 Thailand",
  "US": "🇺🇸 United States",
  "GB": "🇬🇧 United Kingdom",
  "DE": "🇩🇪 Germany",
  "IT": "🇮🇹 Italy",
  "ES": "🇪🇸 Spain",
  "GR": "🇬🇷 Greece"
  // ➕ Add more country codes as needed
};

exports.handler = async () => {
  console.log("🚀 Mobimatter background sync started");

  const {
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
    SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
    SHOPIFY_API_VERSION = "2025-04"
  } = process.env;

  const MOBIMATTER_API_URL = "https://api.mobimatter.com/mobimatter/api/v2/products";
  const created = [];
  const failed = [];

  try {
    const mobiRes = await fetch(MOBIMATTER_API_URL, {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        "merchantId": MOBIMATTER_MERCHANT_ID
      }
    });

    if (!mobiRes.ok) {
      throw new Error(`Mobimatter API failed: ${mobiRes.status}`);
    }

    const { result: products } = await mobiRes.json();
    console.log(`✅ Fetched ${products.length} products`);

    for (const product of products.slice(0, 10)) {
      try {
        const details = {};
        (product.productDetails || []).forEach(({ name, value }) => {
          details[name.trim()] = value;
        });

        const title = details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM";
        const price = product.retailPrice?.toFixed(2);
        const image = product.providerLogo;
        const countries = (product.countries || []).map(code => countryMap[code] || `🌐 ${code}`);

        const descriptionHtml = `
          <div class="esim-description">
            <h3>${title}</h3>
            <div class="countries-section">
              <p><strong>Countries:</strong></p>
              <ul>${countries.map(c => `<li>${c}</li>`).join("")}</ul>
            </div>
            <p><strong>Data:</strong> ${details.PLAN_DATA_LIMIT || "?"} ${details.PLAN_DATA_UNIT || "GB"}</p>
            <p><strong>Validity:</strong> ${details.PLAN_VALIDITY || "?"} days</p>
            ${details.FIVEG === "1" ? "<p><strong>Network:</strong> 5G Supported</p>" : ""}
            ${details.SPEED ? `<p><strong>Speed:</strong> ${details.SPEED}</p>` : ""}
            ${details.TOPUP === "1" ? "<p><strong>Top-up:</strong> Available</p>" : ""}
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
            productType: "eSIM",
            vendor: product.providerName || "Mobimatter",
            tags: [
              details.FIVEG === "1" ? "5G" : "4G",
              `data-${details.PLAN_DATA_LIMIT || "?"}${details.PLAN_DATA_UNIT || "GB"}`,
              ...(product.countries || []).map(c => `country-${c}`)
            ],
            status: "ACTIVE", // Push to all sales channels
            variants: [
              {
                price,
                sku: product.productId,
                inventoryQuantity: 999999,
                fulfillmentService: "manual",
                inventoryManagement: null,
                taxable: true
              }
            ],
            images: image ? [{ src: image }] : []
          }
        };

        const shopifyRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY
          },
          body: JSON.stringify({ query: mutation, variables })
        });

        const json = await shopifyRes.json();
        if (json.errors || json.data?.productCreate?.userErrors?.length) {
          console.error("❌ Shopify Error:", JSON.stringify(json, null, 2));
          failed.push({ title, reason: JSON.stringify(json.errors || json.data.productCreate.userErrors) });
        } else {
          console.log(`✅ Created: ${title}`);
          created.push(title);
        }

      } catch (err) {
        console.error("❌ Product sync failed:", err);
        failed.push({ title: product.productFamilyName, reason: err.message });
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Created ${created.length} product(s)`, created, failed })
    };

  } catch (err) {
    console.error("❌ Global error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Unexpected error", message: err.message })
    };
  }
};
