const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async () => {
  const { MOBIMATTER_API_KEY, MOBIMATTER_MERCHANT_ID, SHOPIFY_ADMIN_API_KEY, SHOPIFY_STORE_DOMAIN, SHOPIFY_API_VERSION = "2025-04" } = process.env;
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

    if (!response.ok) throw new Error(`Mobimatter fetch failed: ${response.status}`);
    const { result: products } = await response.json();
    console.log(`Fetched ${products.length} products`);

    for (const product of products.slice(0, 30)) {
      const handle = `mobimatter-${product.uniqueId}`.toLowerCase();

      // 🔍 Check for existing product by handle
      const checkRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products.json?handle=${handle}`, {
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
        },
      });
      const { products: existing } = await checkRes.json();
      if (existing.length > 0) {
        console.log(`Skipping duplicate by handle: ${handle}`);
        skipped.push(product.productFamilyName || "Unnamed");
        continue;
      }

      try {
        const details = getProductDetails(product);
        const logoUrl = await uploadFileToShopify(product.providerLogo);  // Upload logo file

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
          metafields: [
            {
              namespace: "esim",
              key: "provider_logo",
              value: logoUrl,  // The file URL from Shopify file upload
              valueType: "FILE", // Correct metafield type for files
            },
            {
              namespace: "esim",
              key: "countries",
              value: product.countries.join(", "),
              valueType: "STRING",
            },
            {
              namespace: "esim",
              key: "fiveg",
              value: product.fiveg ? "Yes" : "No",
              valueType: "STRING",
            },
            {
              namespace: "esim",
              key: "topup",
              value: product.topup ? "Available" : "Not Available",
              valueType: "STRING",
            },
            {
              namespace: "esim",
              key: "validity",
              value: product.validity || "N/A",
              valueType: "STRING",
            },
            {
              namespace: "esim",
              key: "data_limit",
              value: product.dataLimit || "N/A",
              valueType: "STRING",
            },
          ],
          published: true,
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

        console.log("Creating product:", input.title);
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
          continue;
        }

        if (shopifyId) {
          created.push(input.title);
        }
      } catch (err) {
        console.error("Error syncing product:", err.message);
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
