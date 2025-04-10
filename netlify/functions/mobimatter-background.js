const fetch = require('node-fetch');

exports.handler = async function () {
  console.log('🚀 Mobimatter background sync started');

  try {
    const response = await fetch('https://api.mobimatter.com/mobimatter/api/v2/products');
    const mobimatterProducts = await response.json();
    console.log(`✅ Fetched ${mobimatterProducts.length} products`);

    const selectedProducts = mobimatterProducts.slice(0, 10); // Limit per sync

    for (const product of selectedProducts) {
      const title = product.name;
      const descriptionHtml = generateHtmlDescription(product);
      const vendor = product.provider.name || 'Mobimatter';
      const productType = 'eSIM';
      const tags = generateTags(product);
      const price = product.price.amount.toFixed(2);
      const imageSrc = product.provider.logoUrl;

      // 1. Create the product
      const createdProduct = await shopifyGraphQL(`
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
      `, {
        input: {
          title,
          descriptionHtml,
          vendor,
          productType,
          tags,
          status: 'ACTIVE',
        }
      });

      const productId = createdProduct.data?.productCreate?.product?.id;
      if (!productId) {
        console.error('❌ Failed to create product:', createdProduct.errors || createdProduct.data?.productCreate?.userErrors);
        continue;
      }

      // 2. Add variant
      await shopifyGraphQL(`
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
      `, {
        input: {
          productId,
          price,
          sku: product.id,
          inventoryQuantity: 999999,
          fulfillmentService: 'manual',
          inventoryManagement: null,
          taxable: true
        }
      });

      // 3. Add image
      await shopifyGraphQL(`
        mutation productImageCreate($productId: ID!, $image: ImageInput!) {
          productImageCreate(productId: $productId, image: $image) {
            image {
              id
            }
            userErrors {
              field
              message
            }
          }
        }
      `, {
        productId,
        image: {
          src: imageSrc
        }
      });

      console.log(`✅ Synced product: ${title}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Products synced successfully.' }),
    };

  } catch (error) {
    console.error('❌ Error syncing products:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

// Shopify GraphQL helper
async function shopifyGraphQL(query, variables) {
  const endpoint = 'https://v861gm-fd.myshopify.com/admin/api/2025-04/graphql.json';

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });

  return await response.json();
}

// Generate full HTML with country flags
function generateHtmlDescription(product) {
  const countries = product.countries.map(c => `<li>${getFlagEmoji(c)} ${getCountryName(c)}</li>`).join('');
  const network = product.is5G ? '5G Supported' : '4G Only';

  return `
    <div class="esim-description">
      <h3>${product.name}</h3>
      <div class="countries-section">
        <p><strong>Countries:</strong></p>
        <ul>${countries}</ul>
      </div>
      <p><strong>Data:</strong> ${product.dataAmount}</p>
      <p><strong>Validity:</strong> ${product.validityDays} days</p>
      <p><strong>Network:</strong> ${network}</p>
      <p><strong>Speed:</strong> ${product.speed}</p>
      ${product.isTopupSupported ? '<p><strong>Top-up:</strong> Available</p>' : ''}
      <p><strong>Provider:</strong> ${product.provider.name}</p>
    </div>
  `;
}

// Add relevant tags
function generateTags(product) {
  const tagList = [];
  if (product.is5G) tagList.push('5G');
  tagList.push(`data-${product.dataAmount}`);
  product.countries.forEach(c => tagList.push(`country-${c}`));
  return tagList;
}

// Util: Get flag emoji from country code
function getFlagEmoji(countryCode) {
  const codePoints = [...countryCode.toUpperCase()].map(char => 0x1f1e6 + char.charCodeAt(0) - 65);
  return String.fromCodePoint(...codePoints);
}

// Util: Country name lookup
function getCountryName(code) {
  const map = {
    US: 'United States', GB: 'United Kingdom', FR: 'France', DE: 'Germany', ES: 'Spain', IT: 'Italy',
    JP: 'Japan', CN: 'China', IN: 'India', RU: 'Russia', BR: 'Brazil', CA: 'Canada', AU: 'Australia',
    VN: 'Vietnam', TH: 'Thailand', RS: 'Serbia', ME: 'Montenegro', BG: 'Bulgaria', ID: 'Indonesia',
    // Add more as needed
  };
  return map[code] || code;
}
