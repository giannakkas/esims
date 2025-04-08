const fetch = require('node-fetch');

exports.handler = async function () {
  const {
    MOBIMATTER_API_KEY,
    MOBIMATTER_MERCHANT_ID,
    SHOPIFY_ADMIN_API_KEY,
    SHOPIFY_STORE_DOMAIN,
    SHOPIFY_API_VERSION = '2025-01',
  } = process.env;

  const mobimatterUrl = 'https://api.mobimatter.com/mobimatter/api/v2/products';

  try {
    // Fetch products from Mobimatter
    const response = await fetch(mobimatterUrl, {
      headers: {
        'api-key': MOBIMATTER_API_KEY,
        'merchantId': MOBIMATTER_MERCHANT_ID,
      },
    });

    if (!response.ok) {
      throw new Error(`Mobimatter fetch failed: ${response.status}`);
    }

    const { result: products } = await response.json();

    // Process each product
    for (const product of products) {
      // Extract and format product details
      const productDetails = {};
      for (const detail of product.productDetails) {
        productDetails[detail.name.trim()] = detail.value;
      }

      const has5G = productDetails['FIVEG'] === '1' ? '5G' : '4G';
      const speed = productDetails['SPEED'] || 'N/A';
      const topUp = productDetails['TOPUP'] === '1' ? 'Available' : 'Not available';
      const countries = product.countries.join(', ');
      const price = product.retailPrice.toFixed(2);
      const validity = productDetails['PLAN_VALIDITY'] || 'N/A';
      const dataLimit = `${productDetails['PLAN_DATA_LIMIT'] || '?'} ${productDetails['PLAN_DATA_UNIT'] || 'GB'}`;

      const description = `
        <p><strong>Network:</strong> ${has5G}</p>
        <p><strong>Speed:</strong> ${speed}</p>
        <p><strong>Top-up:</strong> ${topUp}</p>
        <p><strong>Countries:</strong> ${countries}</p>
        <p><strong>Data:</strong> ${dataLimit}</p>
        <p><strong>Validity:</strong> ${validity} days</p>
      `;

      const shopifyProduct = {
        product: {
          title: productDetails['PLAN_TITLE'] || product.productFamilyName,
          body_html: description,
          vendor: product.providerName,
          product_type: 'eSIM',
          tags: [has5G, 'eSIM'],
          variants: [{
            price: price,
            sku: product.uniqueId,
            inventory_quantity: 999999,
            inventory_management: null,
            fulfillment_service: 'manual',
            taxable: true,
          }],
          images: [{
            src: product.providerLogo,
          }],
        },
      };

      // Send to Shopify
      const shopifyResponse = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_KEY,
        },
        body: JSON.stringify(shopifyProduct),
      });

      if (!shopifyResponse.ok) {
        const errorText = await shopifyResponse.text();
        console.error(`Failed to create product: ${shopifyProduct.product.title}. Error: ${errorText}`);
      } else {
        console.log(`Successfully created product: ${shopifyProduct.product.title}`);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Product sync completed.' }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Mobimatter fetch or Shopify sync failed', message: err.message }),
    };
  }
};
