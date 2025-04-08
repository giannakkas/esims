// ./netlify/functions/mobimatter-cron.js
const fetch = require('node-fetch');

exports.handler = async function () {
  const { MOBIMATTER_API_KEY, MOBIMATTER_MERCHANT_ID, SHOPIFY_ADMIN_API_KEY, SHOPIFY_STORE_DOMAIN } = process.env;

  const mobimatterUrl = "https://api.mobimatter.com/mobimatter/api/v2/products";
  
  try {
    const response = await fetch(mobimatterUrl, {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID,
      },
    });

    if (!response.ok) {
      throw new Error(`Mobimatter fetch failed: ${response.status}`);
    }

    const { result: products } = await response.json();
    
    const created = [], failed = [];
    for (const product of products.slice(0, 10)) {
      const title = product.title;
      const price = product.retailPrice?.toFixed(2);
      
      if (!title || !price) {
        failed.push({ title: title || "(missing)", reason: "Missing title or price" });
        continue;
      }

      const body_html = `
        <p><strong>Network:</strong> ${product.network || "Unknown"}</p>
        <p><strong>Speed:</strong> ${product.speed || "Unknown"}</p>
        <p><strong>Top-up:</strong> ${product.topUp ? "Available" : "Not Available"}</p>
        <p><strong>Countries:</strong> ${product.countries.join(", ")}</p>
        <p><strong>Data:</strong> ${product.planDataLimit} GB</p>
      `;
      
      const productPayload = {
        product: {
          title,
          body_html,
          vendor: product.providerName || "Mobimatter",
          product_type: "eSIM",
          tags: ["eSIM"],
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
        },
      };

      const shopifyRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/products.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
        },
        body: JSON.stringify(productPayload),
      });

      if (!shopifyRes.ok) {
        const errorText = await shopifyRes.text();
        failed.push({ title, reason: errorText });
      } else {
        created.push(title);
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
