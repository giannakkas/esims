const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Map ISO country codes to full names and flags
const COUNTRY_INFO = {
  US: { name: "United States", flag: "🇺🇸" },
  GB: { name: "United Kingdom", flag: "🇬🇧" },
  FR: { name: "France", flag: "🇫🇷" },
  DE: { name: "Germany", flag: "🇩🇪" },
  IT: { name: "Italy", flag: "🇮🇹" },
  JP: { name: "Japan", flag: "🇯🇵" },
  VN: { name: "Vietnam", flag: "🇻🇳" },
  RS: { name: "Serbia", flag: "🇷🇸" },
  ME: { name: "Montenegro", flag: "🇲🇪" },
  BG: { name: "Bulgaria", flag: "🇧🇬" },
  ID: { name: "Indonesia", flag: "🇮🇩" },
  // Add more country codes here as needed
};

const getCountryDisplay = (code) => {
  const country = COUNTRY_INFO[code];
  return country ? `${country.flag} ${country.name}` : `🌐 ${code}`;
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

  return `
    <div class="esim-description">
      <h3>${details.PLAN_TITLE || product.productFamilyName || "eSIM Plan"}</h3>
      <div class="countries-section">
        <p><strong>Countries:</strong></p>
        <ul>${countries}</ul>
      </div>
      <p><strong>Data:</strong> ${details.PLAN_DATA_LIMIT || "?"} ${details.PLAN_DATA_UNIT || "GB"}</p>
      <p><strong>Validity:</strong> ${details.PLAN_VALIDITY || "?"} days</p>
      ${details.FIVEG === "1" ? "<p><strong>Network:</strong> 5G Supported</p>" : ""}
      ${details.SPEED ? `<p><strong>Speed:</strong> ${details.SPEED}</p>` : ""}
      ${details.TOPUP === "1" ? "<p><strong>Top-up:</strong> Available</p>" : ""}
      <p><strong>Provider:</strong> ${product.providerName || "Mobimatter"}</p>
    </div>
  `;
};

exports.handler = async () => {
  const {
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
    SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
    SHOPIFY_API_VERSION = "2025-04",
  } = process.env;

  const MOBIMATTER_API_URL = "https://api.mobimatter.com/mobimatter/api/v2/products";
  const created = [];
  const failed = [];

  try {
    const response = await fetch(MOBIMATTER_API_URL, {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
      },
    });

    if (!response.ok) throw new Error(`Mobimatter fetch failed: ${response.status}`);
    const { result: products } = await response.json();

    for (const product of products.slice(0, 10)) {
      try {
        const details = getProductDetails(product);

        const input = {
          title: details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM",
          descriptionHtml: buildDescription(product, details),
          vendor: product.providerName || "Mobimatter",
          productType: "eSIM",
          tags: [
            details.FIVEG === "1" ? "5G" : "4G",
            `data-${details.PLAN_DATA_LIMIT || "unlimited"}${details.PLAN_DATA_UNIT || "GB"}`,
            ...(product.countries || []).map((c) => `country-${c}`),
          ],
          status: "ACTIVE",
        };

        const mutation = `
          mutation productCreate($input: ProductInput!) {
            productCreate(input: $input) {
              product {
                id
                title
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const shopifyRes = await fetch(
          `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
            },
            body: JSON.stringify({ query: mutation, variables: { input } }),
          }
        );

        const json = await shopifyRes.json();

        const userErrors = json?.data?.productCreate?.userErrors;
        const shopifyId = json?.data?.productCreate?.product?.id;

        if (userErrors && userErrors.length) {
          failed.push({ title: input.title, reason: userErrors.map((e) => e.message).join(", ") });
        } else if (shopifyId) {
          // Attach price + image using REST Admin API
          const variantRes = await fetch(
            `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products/${shopifyId.split("/").pop()}/variants.json`,
            {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
              },
            }
          );

          const { variants } = await variantRes.json();
          const variantId = variants[0]?.id;

          if (variantId) {
            await fetch(
              `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/variants/${variantId}.json`,
              {
                method: "PUT",
                headers: {
                  "Content-Type": "application/json",
                  "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
                },
                body: JSON.stringify({
                  variant: {
                    id: variantId,
                    price: product.retailPrice?.toFixed(2),
                    sku: product.uniqueId,
                    inventory_quantity: 999999,
                  },
                }),
              }
            );
          }

          if (product.providerLogo) {
            await fetch(
              `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products/${shopifyId.split("/").pop()}/images.json`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
                },
                body: JSON.stringify({
                  image: {
                    src: product.providerLogo,
                  },
                }),
              }
            );
          }

          created.push(input.title);
        }
      } catch (err) {
        failed.push({ title: product.productFamilyName || "Unnamed", reason: err.message });
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Created ${created.length} product(s)`,
        created,
        failed,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Mobimatter fetch or Shopify sync failed",
        message: err.message,
      }),
    };
  }
};
