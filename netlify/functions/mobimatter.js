const axios = require("axios");

exports.handler = async () => {
  const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
  const SHOPIFY_ADMIN_API_KEY = process.env.SHOPIFY_ADMIN_API_KEY;
  const SHOPIFY_API_VERSION = "2025-01";
  const MOBIMATTER_API_KEY = process.env.MOBIMATTER_API_KEY;
  const MOBIMATTER_MERCHANT_ID = process.env.MOBIMATTER_MERCHANT_ID;

  const headers = {
    "x-api-key": MOBIMATTER_API_KEY,
    "x-merchant-id": MOBIMATTER_MERCHANT_ID,
  };

  try {
    const mobimatterRes = await axios.get("https://api.mobimatter.com/partner/products", { headers });
    const products = mobimatterRes.data.result;

    const created = [];
    const failed = [];

    // Loop through the first few products (for testing purposes)
    for (let product of products.slice(0, 10)) {
      const title = product.productFamilyName;
      const price = product.retailPrice.toFixed(2);
      const description = product.productFamilyName;
      const tags = ["eSIM", "Top-Up", "Unrestricted"];

      // Shopify API request
      try {
        const shopifyRes = await axios.post(
          `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products.json`,
          {
            product: {
              title,
              body_html: description,
              vendor: product.providerName,
              product_type: "eSIM",
              tags,
              variants: [
                {
                  price,
                  sku: product.uniqueId,
                  inventory_policy: "continue",
                  fulfillment_service: "manual",
                  inventory_management: null,
                  requires_shipping: false,
                },
              ],
            },
          },
          {
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
            },
          }
        );

        created.push({ title, id: shopifyRes.data.product.id });
      } catch (shopifyErr) {
        failed.push({
          title,
          reason: shopifyErr.response?.data?.errors || shopifyErr.message,
        });
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
