const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Country flag emojis
const COUNTRY_FLAGS = new Proxy({}, {
  get: (target, code) => {
    if (!code || typeof code !== 'string' || code.length !== 2) return '🌐';
    const flag = code.toUpperCase().replace(/./g, char =>
      String.fromCodePoint(127397 + char.charCodeAt())
    );
    return flag;
  }
});

exports.handler = async () => {
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
    const response = await fetch(MOBIMATTER_API_URL, {
      headers: {
        "api-key": MOBIMATTER_API_KEY,
        merchantId: MOBIMATTER_MERCHANT_ID
      }
    });

    if (!response.ok) {
      throw new Error(`Mobimatter fetch failed: ${response.status}`);
    }

    const { result: products } = await response.json();

    for (const product of products.slice(0, 10)) {
      const details = {};
      (product.productDetails || []).forEach(({ name, value }) => {
        details[name.trim()] = value;
      });

      const title = details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM";
      const price = product.retailPrice?.toFixed(2);
      const sku = product.uniqueId;
      const imageSrc = product.providerLogo;
      const vendor = product.providerName || "Mobimatter";
      const dataAmount = `${details.PLAN_DATA_LIMIT || "?"} ${details.PLAN_DATA_UNIT || "GB"}`;
      const validity = details.PLAN_VALIDITY || "?";
      const speed = details.SPEED || "Unknown";
      const topUp = details.TOPUP === "1" ? "Available" : "Not available";
      const has5G = details.FIVEG === "1" ? "5G" : "4G";
      const countries = (product.countries || []).map(c => `${COUNTRY_FLAGS[c]} ${c}`).join("<br>");

      const descriptionHtml = `
        <div class="esim-description">
          <h3>${title}</h3>
          <p><strong>Network:</strong> ${has5G}</p>
          <p><strong>Speed:</strong> ${speed}</p>
          <p><strong>Top-up:</strong> ${topUp}</p>
          <p><strong>Countries:</strong><br>${countries}</p>
          <p><strong>Data:</strong> ${dataAmount}</p>
          <p><strong>Validity:</strong> ${validity} days</p>
          <p><strong>Provider:</strong> ${vendor}</p>
        </div>
      `;

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

      const variables = {
        input: {
          title,
          descriptionHtml,
          vendor,
          productType: "eSIM",
          tags: [
            has5G,
            `data-${details.PLAN_DATA_LIMIT || 'unlimited'}${details.PLAN_DATA_UNIT || 'GB'}`,
            ...(product.countries || []).map(c => `country-${c}`)
          ],
          status: "ACTIVE"
        }
      };

      const shopifyResponse = await fetch(
        `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY
          },
          body: JSON.stringify({ query: mutation, variables })
        }
      );

      const shopifyJson = await shopifyResponse.json();
      const userErrors = shopifyJson?.data?.productCreate?.userErrors;

      if (userErrors?.length) {
        failed.push({
          title,
          reason: userErrors.map(e => e.message).join(", ")
        });
      } else {
        const productId = shopifyJson?.data?.productCreate?.product?.id;

        // Add price variant with separate call
        const variantMutation = `
          mutation productVariantCreate($input: ProductVariantInput!) {
            productVariantCreate(input: $input) {
              productVariant {
                id
              }
              userErrors {
                field
                message
              }
            }
          }
        `;
        const variantInput = {
          input: {
            productId,
            price,
            sku,
            inventoryQuantity: 999999,
            inventoryManagement: null,
            fulfillmentService: "manual",
            taxable: true
          }
        };

        const variantResponse = await fetch(
          `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY
            },
            body: JSON.stringify({ query: variantMutation, variables: variantInput })
          }
        );

        const variantJson = await variantResponse.json();
        if (variantJson?.data?.productVariantCreate?.userErrors?.length) {
          failed.push({ title, reason: "Price variant error" });
        } else {
          created.push(title);
        }
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Created ${created.length} product(s)`,
        created,
        failed
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Mobimatter fetch or Shopify sync failed",
        message: err.message
      })
    };
  }
};
