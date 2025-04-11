// Refactor to use async function for dynamic import
async function loadModules() {
  try {
    const fetch = (await import('node-fetch')).default;
    const { FormData } = await import('formdata-polyfill');
    return { fetch, FormData };
  } catch (error) {
    console.error("Error importing modules:", error);
    throw error;
  }
}

export const handler = async (event, context) => {
  try {
    // Load the necessary modules dynamically
    const { fetch, FormData } = await loadModules();

    // Main logic for syncing products here
    await syncProducts(fetch, FormData);
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

// Sync products from Mobimatter API to Shopify
async function syncProducts(fetch, FormData) {
  const products = await fetchMobimatterProducts(fetch);
  let createdCount = 0;

  // Process only 5 products for now
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
        providerLogo: product.PROVIDER_LOGO_URL,
        countries: product.PHONE_NUMBER_PREFIX,
        FIVEG: product.FIVEG,
        TOPUP: product.TOPUP,
        PLAN_VALIDITY: product.PLAN_VALIDITY,
        PLAN_DATA_LIMIT: product.PLAN_DATA_LIMIT,
        PLAN_DATA_UNIT: product.PLAN_DATA_UNIT,
      };

      await createShopifyProduct(fetch, productDetails);
      createdCount++;
    } catch (error) {
      console.error(`Error processing product: ${product.PLAN_TITLE}`, error);
    }
  }

  console.log(`Sync complete. Created: ${createdCount} products.`);
}

// Fetch products from Mobimatter API
async function fetchMobimatterProducts(fetch) {
  console.log('Fetching from Mobimatter API...');
  const mobimatterProducts = [];  // Replace with actual fetching logic
  console.log(`Fetched ${mobimatterProducts.length} products from Mobimatter API.`);
  return mobimatterProducts;
}

// Function to create products in Shopify
async function createShopifyProduct(fetch, product) {
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
      console.error('Shopify product creation failed:', data.errors);
      return;
    }

    if (data.data.productCreate.userErrors.length > 0) {
      console.error('Shopify product creation failed:', data.data.productCreate.userErrors);
      return;
    }

    console.log(`Product created: ${product.title}`);
  } catch (error) {
    console.error('Error creating product in Shopify:', error);
  }
}
