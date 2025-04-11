const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// 🌍 Generate flags + country names for all ISO codes
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
  const skipped = [];
  const failed = [];

  try {
    console.log("Fetching from Mobimatter API...");
    const response = await fetch(MOBIMATTER_API_URL, {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch from Mobimatter API: ${response.status}`);
      throw new Error(`Mobimatter fetch failed: ${response.status}`);
    }

    const { result: products } = await response.json();
    console.log(`Fetched ${products.length} products`);

    for (const product of products.slice(0, 5)) {
      console.log(`Processing product: ${product.productFamilyName}`);

      const handle = `mobimatter-${product.uniqueId}`.toLowerCase();

      // 🔍 Check for existing product by handle
      const checkRes = await fetch(
        `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products.json?handle=${handle}`,
        {
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
          },
        }
      );
      const { products: existing } = await checkRes.json();
      if (existing.length > 0) {
        console.log(`Skipping duplicate product: ${handle}`);
        skipped.push(product.productFamilyName || "Unnamed");
        continue;
      }

      try {
        const details = getProductDetails(product);
        console.log(`Product details: ${JSON.stringify(details)}`);

        const input = {
          title: details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM",
          handle,
          descriptionHtml: buildDescription(product, details),
          vendor: product.providerName || "Mobimatter",
          productType: "eSIM",
          tags: [
            details.FIVEG === "1" ? "5G" : "4G",
            `data-${details.PLAN_DATA_LIMIT || "unlimited"}${details.PLAN_DATA_UNIT || "GB"}`,
            ...(product.countries || []).map((c) => `country-${c}`),
          ],
          published: true,
          metafields: [
            {
              namespace: "esim",
              key: "provider_logo",
              value: product.providerLogo || "",
              valueType: "file",
            },
            {
              namespace: "esim",
              key: "countries",
              value: (product.countries || []).join("\n"),
              valueType: "multi_line_text_field",
            },
            {
              namespace: "esim",
              key: "fiveg",
              value: details.FIVEG === "1" ? "5G" : "4G",
              valueType: "single_line_text_field",
            },
            {
              namespace: "esim",
              key: "topup",
              value: details.TOPUP === "1" ? "Available" : "Not Available",
              valueType: "single_line_text_field",
            },
            {
              namespace: "esim",
              key: "validity",
              value: details.PLAN_VALIDITY || "?",
              valueType: "single_line_text_field",
            },
            {
              namespace: "esim",
              key: "data_limit",
              value: `${details.PLAN_DATA_LIMIT || "unlimited"} ${details.PLAN_DATA_UNIT || "GB"}`,
              valueType: "single_line_text_field",
            },
          ],
        };

        console.log(`Creating product with handle: ${handle}`);
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
        console.log(`Shopify response: ${JSON.stringify(json)}`);

        const userErrors = json?.data?.productCreate?.userErrors;
        const shopifyId = json?.data?.productCreate?.product?.id;

        if (userErrors && userErrors.length) {
          console.error(`Errors creating product ${input.title}: ${JSON.stringify(userErrors)}`);
          failed.push({ title: input.title, reason: userErrors.map((e) => e.message).join(", ") });
          continue;
        }

        if (shopifyId) {
          console.log(`Product created successfully: ${input.title} with ID: ${shopifyId}`);
          created.push(input.title);
        }
      } catch (err) {
        console.error(`Error syncing product ${product.productFamilyName || "Unnamed"}: ${err.message}`);
        failed.push({ title: product.productFamilyName || "Unnamed", reason: err.message });
      }
    }

    console.log("Sync complete. Created:", created.length, "Skipped:", skipped.length, "Failed:", failed.length);
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Created ${created.length}, Skipped ${skipped.length}, Failed ${failed.length}`,
        created,
        skipped,
        failed,
      }),
    };
  } catch (err) {
    console.error("Fatal error:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Mobimatter fetch or Shopify sync failed",
        message: err.message,
      }),
    };
  }
};
