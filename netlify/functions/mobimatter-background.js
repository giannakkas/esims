// Importing necessary libraries
import fetch from 'node-fetch';

async function loadFetch() {
  let fetch;
  try {
    fetch = (await import('node-fetch')).default;
    return fetch;
  } catch (error) {
    console.error('Error importing fetch module:', error);
    throw error;
  }
}

// Helper function to log errors
const logError = (message, details) => {
  console.error(`ERROR: ${message}`);
  if (details) console.error(details);
};

// Shopify Store Domain and API Key
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_API_PASSWORD = process.env.SHOPIFY_API_PASSWORD;

// Function to create product in Shopify
async function createShopifyProduct(product) {
  console.log(`Creating product: ${product.title}`);

  const metafields = [
    {
      namespace: 'esim',
      key: 'provider_logo',
      value: product.providerLogo || '',
      valueType: 'file',
    },
    {
      namespace: 'esim',
      key: 'countries',
      value: (product.countries || []).join('\n'),
      valueType: 'multi_line_text_field',
    },
    {
      namespace: 'esim',
      key: 'fiveg',
      value: product.FIVEG === '1' ? '5G' : '4G',
      valueType: 'single_line_text_field',
    },
    {
      namespace: 'esim',
      key: 'topup',
      value: product.TOPUP === '1' ? 'Available' : 'Not Available',
      valueType: 'single_line_text_field',
    },
    {
      namespace: 'esim',
      key: 'validity',
      value: product.PLAN_VALIDITY || '?',
      valueType: 'single_line_text_field',
    },
    {
      namespace: 'esim',
      key: 'data_limit',
      value: `${product.PLAN_DATA_LIMIT || 'unlimited'} ${product.PLAN_DATA_UNIT || 'GB'}`,
      valueType: 'single_line_text_field',
    },
  ];

  const productData = {
    query: `
      mutation {
        productCreate(input: {
          title: "${product.title}",
          handle: "${product.handle}",
          descriptionHtml: "${product.descriptionHtml}",
          vendor: "${product.vendor}",
          productType: "${product.productType}",
          tags: ${JSON.stringify(product.tags)},
          published: true,
          metafields: ${JSON.stringify(metafields)}
        }) {
          product {
            id
            title
            handle
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
  };

  try {
    const fetch = await loadFetch();
    const response = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-04/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': SHOPIFY_API_PASSWORD,
      },
      body: JSON.stringify(productData),
    });

    const data = await response.json();
    if (data.errors) {
      logError('Shopify product creation failed:', data.errors);
      return;
    }

    if (data.data.productCreate.userErrors.length > 0) {
      logError('Shopify product creation failed:', data.data.productCreate.userErrors);
      return;
    }

    console.log(`Product created: ${product.title}`);
  } catch (error) {
    logError('Error creating product in Shopify:', error);
  }
}

// Fetch products from Mobimatter API
async function fetchMobimatterProducts() {
  console.log('Fetching from Mobimatter API...');

  const mobimatterProducts = [];  // Assume you fetch products here

  console.log(`Fetched ${mobimatterProducts.length} products from Mobimatter API.`);

  return mobimatterProducts;
}

// Main function to sync products
async function syncProducts() {
  const products = await fetchMobimatterProducts();
  let createdCount = 0;

  // Process the first 5 products for now
  const productsToSync = products.slice(0, 5);

  for (const product of productsToSync) {
    try {
      console.log(`Processing product: ${product.PLAN_TITLE}`);
      const productDetails = {
        title: product.PLAN_TITLE,
        handle: `mobimatter-${product.PLAN_TITLE.replace(/\s+/g, '-').toLowerCase()}`,
        descriptionHtml: `<div class="esim-description">
                            <h3>${product.PLAN_TITLE}</h3>
                            <div class="countries-section">
                              <p><strong>Countries:</strong></p>
                              <ul><li>${product.PHONE_NUMBER_PREFIX}</li></ul>
                            </div>
                            <p><strong>Data:</strong> ${product.PLAN_DATA_LIMIT} ${product.PLAN_DATA_UNIT}</p>
                            <p><strong>Validity:</strong> ${product.PLAN_VALIDITY} days</p>
                            <p><strong>Network:</strong> ${product.FIVEG === "1" ? "5G Supported" : "4G Supported"}</p>
                            <p><strong>Speed:</strong> ${product.SPEED_LONG}</p>
                            <p><strong>Provider:</strong> ${product.vendor}</p>
                          </div>`,
        vendor: product.vendor,
        productType: 'eSIM',
        tags: [product.FIVEG === "1" ? "5G" : "4G", `data-${product.PLAN_DATA_LIMIT}`, `country-${product.PHONE_NUMBER_PREFIX}`],
        providerLogo: product.PROVIDER_LOGO_URL,  // Assume you fetch URL from the product
        countries: product.PHONE_NUMBER_PREFIX,  // Country from product details
        FIVEG: product.FIVEG,
        TOPUP: product.TOPUP,
        PLAN_VALIDITY: product.PLAN_VALIDITY,
        PLAN_DATA_LIMIT: product.PLAN_DATA_LIMIT,
        PLAN_DATA_UNIT: product.PLAN_DATA_UNIT,
      };

      await createShopifyProduct(productDetails);
      createdCount++;
    } catch (error) {
      logError(`Error processing product: ${product.PLAN_TITLE}`, error);
    }
  }

  console.log(`Sync complete. Created: ${createdCount} products.`);
}

// Start the sync
syncProducts().catch(logError);

// Export the handler for Netlify
export const handler = async (event, context) => {
  try {
    await syncProducts();
    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Sync completed successfully" }),
    };
  } catch (error) {
    console.error('Error during sync', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Error during sync", error: error.message }),
    };
  }
};
