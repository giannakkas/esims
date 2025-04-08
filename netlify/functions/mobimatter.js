const fetch = require("node-fetch");

exports.handler = async function () {
  const {
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
    SHOPIFY_STORE_DOMAIN,
    SHOPIFY_API_KEY,
    SHOPIFY_API_VERSION,
  } = process.env;

  const mobimatterUrl = `https://api.mobimatter.com/api/product/active-products?merchantId=${MOBIMATTER_MERCHANT_ID}`;

  try {
    const response = await fetch(mobimatterUrl, {
      headers: {
        "Ocp-Apim-Subscription-Key": MOBIMATTER_API_KEY,
      },
    });

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: "Mobimatter fetch failed" }),
      };
    }

    const { result: products } = await response.json();
    const shopifyUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products.json`;

    let created = [];
    let failed = [];

    for (const product of products.slice(0, 5)) { // limit to 5 for testing
      const details = Object.fromEntries(
        product.productDetails.map(({ name, value }) => [name.trim(), value])
      );

      const title = details["PLAN_TITLE"] || "Untitled eSIM";
      const country = product.countries?.[0] || "Unknown";
      const speed = details["FIVEG"] === "1" ? "5G" : "4G";
      const topup = details["TOPUP"] === "1" ? "Yes" : "No";
      const description = `
        <p><strong>${details["PLAN_DATA_LIMIT"] || "0"} ${details["PLAN_DATA_UNIT"] || "GB"}</strong> data valid for <strong>${details["PLAN_VALIDITY"] || "0"} days</strong>.</p>
        <p>Provider: ${product.providerName}</p>
        <p>Country: ${country}</p>
        <p>Speed: ${speed}</p>
        <p>Top-up: ${topup}</p>
      `;

      const shopifyPayload = {
        product: {
          title,
          body_html: description,
          vendor: product.providerName,
          product_type: "eSIM",
          tags: [`${speed}`, `${country}`, "eSIM"],
          variants: [
            {
              price: product.retailPrice.toFixed(2),
              sku: product.uniqueId,
              inventory_management: null,
              inventory_policy: "continue",
              fulfillment_service: "manual",
              requires_shipping: false,
              taxable: true,
              barcode: product.uniqueId,
            },
          ],
          images: [
            {
              src: product.providerLogo,
            },
          ],
        },
      };

      const shopifyRes = await fetch(shopifyUrl, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(shopifyPayload),
      });

      const resData = await shopifyRes.json();

      if (shopifyRes.ok) {
        created.push({ title });
      } else {
        failed.push({ title, reason: resData.errors || "Unknown error" });
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
