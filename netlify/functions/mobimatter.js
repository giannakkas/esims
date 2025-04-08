const fetch = require("node-fetch");

exports.handler = async function () {
  const {
    MOBIMATTER_API_KEY,
    SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
    SHOPIFY_API_VERSION = "2025-01",
  } = process.env;

  const mobimatterUrl = "https://api.mobimatter.com/mobimatter/api/v2/products";

  try {
    const res = await fetch(mobimatterUrl, {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
      },
    });

    if (!res.ok) {
      throw new Error(`Mobimatter fetch failed: ${res.status}`);
    }

    const { result: products } = await res.json();

    const created = [];
    const failed = [];

    for (const product of products.slice(0, 10)) {
      const details = {};
      (product.productDetails || []).forEach(({ name, value }) => {
        details[name.trim()] = value;
      });

      const has5G = details.FIVEG === "1" ? "5G" : "4G";
      const speed = details.SPEED || "Unspecified";
      const topUp = details.TOPUP === "1" ? "Available" : "Not available";

      const countryFlags = (product.countries || [])
        .map((code) => `:flag-${code.toLowerCase()}:`)
        .join(" ");

      const title = details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM";
      const price = product.retailPrice?.toFixed(2) || "0.00";
      const dataAmount = `${details.PLAN_DATA_LIMIT || "?"} ${details.PLAN_DATA_UNIT || "GB"}`;
      const validity = details.PLAN_VALIDITY || "?";

      const body_html = `
        <p><strong>Network:</strong> ${has5G}</p>
        <p><strong>Speed:</strong> ${speed}</p>
        <p><strong>Top-up:</strong> ${topUp}</p>
        <p><strong>Countries:</strong> ${countryFlags}</p>
        <p><strong>Data:</strong> ${dataAmount}</p>
        <p><strong>Validity:</strong> ${validity} days</p>
      `;

      const productPayload = {
        product: {
          title,
          body_html,
          vendor: product.providerName || "Mobimatter",
          product_type: "eSIM",
          tags: [has5G, "eSIM"],
          status: "active",
          published_scope: "web",
          published_at: new Date().toISOString(),
          variants: [
            {
              price,
              sku: product.uniqueId,
              inventory_quantity: 999999,
              fulfillment_service: "manual",
              inventory_management: null,
              taxable: true,
            },
          ],
          images: [
            {
              src: product.providerLogo,
            },
          ],
        },
      };

      const shopifyRes = await fetch(
        `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
          },
          body: JSON.stringify(productPayload),
        }
      );

      if (!shopifyRes.ok) {
        const error = await shopifyRes.text();
        failed.push({ title, reason: error });
      } else {
        created.push(title);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Created ${created.length} product(s)`, created, failed }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Mobimatter fetch or Shopify sync failed", message: error.message }),
    };
  }
};
