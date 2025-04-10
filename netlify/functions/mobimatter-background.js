const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { parse } = require('path');

// Replace with your actual Shopify credentials
const SHOPIFY_DOMAIN = 'v861gm-fd.myshopify.com';
const SHOPIFY_API_VERSION = '2025-04';
const SHOPIFY_ADMIN_API_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;

exports.handler = async function () {
  console.info('🚀 Mobimatter background sync started');

  try {
    const res = await fetch('https://api.mobimatter.com/mobimatter/api/v2/products');
    const data = await res.json();

    const products = data.products.slice(0, 10);
    console.info(`✅ Fetched ${products.length} products`);

    for (const product of products) {
      const {
        name,
        description,
        countries,
        data: dataAmount,
        validityDays,
        networkType,
        speed,
        topupEnabled,
        operator,
        retailPrice,
        id,
        providerImage,
        image
      } = product;

      const countryList = countries
        .map(code => {
          const flag = String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1A5 + c.charCodeAt(0)));
          return `<li>${flag} ${getCountryName(code)}</li>`;
        })
        .join('');

      const descriptionHtml = `
        <div class="esim-description">
          <h3>${name}</h3>
          <div class="countries-section">
            <p><strong>Countries:</strong></p>
            <ul>${countryList}</ul>
          </div>
          <p><strong>Data:</strong> ${dataAmount}</p>
          <p><strong>Validity:</strong> ${validityDays} days</p>
          ${networkType ? `<p><strong>Network:</strong> ${networkType} Supported</p>` : ''}
          <p><strong>Speed:</strong> ${speed || 'Unrestricted'}</p>
          ${topupEnabled ? `<p><strong>Top-up:</strong> Available</p>` : ''}
          <p><strong>Provider:</strong> ${operator}</p>
        </div>
      `;

      const input = {
        title: name,
        descriptionHtml,
        productType: 'eSIM',
        vendor: operator,
        tags: [
          networkType,
          `data-${dataAmount.replace(/\s/g, '')}`,
          ...countries.map(c => `country-${c}`)
        ],
        status: 'ACTIVE',
        options: ['Title'],
        variants: [
          {
            price: retailPrice,
            sku: id,
            inventoryQuantity: 999999,
            fulfillmentService: 'manual',
            inventoryManagement: null,
            taxable: true
          }
        ],
        images: [
          { src: providerImage || image }
        ],
        published: true
      };

      const response = await createShopifyProduct(input);
      if (response.errors) {
        console.error('❌ Shopify Error:', JSON.stringify(response, null, 2));
      } else {
        console.log(`✅ Created: ${name}`);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Sync complete' })
    };
  } catch (err) {
    console.error('❌ Sync failed:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Sync failed', details: err.message })
    };
  }
};

async function createShopifyProduct(productInput) {
  const response = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: `
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
      `,
      variables: { input: productInput }
    })
  });

  return response.json();
}

function getCountryName(code) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase());
  } catch {
    return code;
  }
}
