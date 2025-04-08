const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Configuration
const CONFIG = {
  SAFETY_TIMEOUT: 9000,         // Stop 1s before Netlify's 10s timeout
  PRODUCTS_PER_RUN: 5,          // Products to process per execution
  MOBIMATTER_API_URL: "https://api.mobimatter.com/mobimatter/api/v2/products",
  SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION || "2025-04",
  IMAGE_UPLOAD_TIMEOUT: 3000    // 3s timeout for image uploads
};

// GraphQL mutations
const SHOPIFY_MUTATION = `
  mutation productCreate($input: ProductInput!) {
    productCreate(input: $input) {
      product {
        id
        title
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const SHOPIFY_IMAGE_MUTATION = `
  mutation productImageCreate($productId: ID!, $image: ImageInput!) {
    productImageCreate(productId: $productId, image: $image) {
      productImage {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// Validate URL format
const isValidUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

// Enhanced image upload with retries
const addProductImage = async (productId, imageUrl, attempt = 1) => {
  if (!productId || !imageUrl) {
    return { success: false, error: "Missing product ID or image URL" };
  }

  if (!isValidUrl(imageUrl)) {
    return { success: false, error: "Invalid image URL format" };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.IMAGE_UPLOAD_TIMEOUT);

    const response = await fetch(
      `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${CONFIG.SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_API_KEY,
        },
        body: JSON.stringify({
          query: SHOPIFY_IMAGE_MUTATION,
          variables: {
            productId: `gid://shopify/Product/${productId}`,
            image: { src: imageUrl }
          }
        }),
        signal: controller.signal
      }
    );

    clearTimeout(timeout);
    const result = await response.json();

    if (result.errors || result.data?.productImageCreate?.userErrors?.length) {
      if (attempt < 3) {
        console.log(`Retrying image upload (attempt ${attempt + 1})`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        return addProductImage(productId, imageUrl, attempt + 1);
      }
      
      const error = result.errors?.[0]?.message || 
                   result.data?.productImageCreate?.userErrors?.[0]?.message ||
                   "Unknown image upload error";
      return { success: false, error };
    }

    return { 
      success: true,
      imageId: result.data?.productImageCreate?.productImage?.id 
    };
  } catch (err) {
    if (attempt < 3) {
      console.log(`Retrying image upload (attempt ${attempt + 1})`);
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      return addProductImage(productId, imageUrl, attempt + 1);
    }
    return { success: false, error: err.message };
  }
};

// Transform product data (Shopify-compatible)
const transformProduct = (product) => {
  const details = {};
  (product.productDetails || []).forEach(({ name, value }) => {
    details[name.trim()] = value;
  });

  return {
    title: details.PLAN_TITLE || product.productFamilyName || "Unnamed eSIM",
    descriptionHtml: `
      <div class="esim-description">
        <p><strong>Data:</strong> ${details.PLAN_DATA_LIMIT || "?"} ${details.PLAN_DATA_UNIT || "GB"}</p>
        <p><strong>Validity:</strong> ${details.PLAN_VALIDITY || "?"} days</p>
        ${details.FIVEG === "1" ? '<p><strong>Technology:</strong> 5G</p>' : ''}
      </div>
    `,
    productType: "eSIM",
    status: "ACTIVE",
    vendor: product.providerName || "Mobimatter",
    tags: [
      details.FIVEG === "1" ? "5G" : "4G",
      "eSIM",
      `data-${details.PLAN_DATA_LIMIT || 'unknown'}${details.PLAN_DATA_UNIT || 'GB'}`
    ]
  };
};

exports.handler = async (event) => {
  const startTime = Date.now();
  const results = {
    processed: 0,
    created: [],
    errors: [],
    skipped: false,
    imageResults: []
  };

  // Calculate remaining execution time
  const getRemainingTime = () => CONFIG.SAFETY_TIMEOUT - (Date.now() - startTime);

  try {
    // 1. Fetch products from MobiMatter API
    const offset = event.queryStringParameters?.offset || 0;
    const apiUrl = `${CONFIG.MOBIMATTER_API_URL}?limit=${CONFIG.PRODUCTS_PER_RUN}&offset=${offset}`;
    
    if (getRemainingTime() < 2000) {
      throw new Error("Insufficient time remaining for API call");
    }

    console.log("Fetching products from:", apiUrl);
    const mobiResponse = await fetch(apiUrl, {
      headers: {
        "api-key": process.env.MOBIMATTER_API_KEY,
        "merchantId": process.env.MOBIMATTER_MERCHANT_ID,
        "Ocp-Apim-Subscription-Key": process.env.MOBIMATTER_SUBSCRIPTION_KEY
      },
      timeout: 2000
    });

    if (!mobiResponse.ok) {
      throw new Error(`MobiMatter API: ${mobiResponse.status} ${await mobiResponse.text()}`);
    }

    const { result: products } = await mobiResponse.json();
    console.log(`Found ${products.length} products to process`);

    // 2. Process products with time monitoring
    for (const product of products) {
      if (getRemainingTime() < 1000) {
        results.skipped = true;
        console.log("Stopping early due to time constraints");
        break;
      }

      const productLog = {
        name: product.productFamilyName || "Unnamed Product",
        hasImage: !!product.providerLogo,
        imageUrl: product.providerLogo
      };

      try {
        // 3. Transform and validate product data
        const productData = transformProduct(product);
        console.log("Creating product:", productLog.name);

        // 4. Create Shopify product
        const createResponse = await fetch(
          `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${CONFIG.SHOPIFY_API_VERSION}/graphql.json`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_API_KEY,
            },
            body: JSON.stringify({
              query: SHOPIFY_MUTATION,
              variables: { input: productData }
            })
          }
        );

        const createData = await createResponse.json();
        
        if (createData.errors || createData.data?.productCreate?.userErrors?.length) {
          const error = createData.errors?.[0]?.message || 
                       createData.data?.productCreate?.userErrors?.[0]?.message ||
                       "Unknown product creation error";
          throw new Error(error);
        }

        const productId = createData.data?.productCreate?.product?.id?.split('/').pop();
        console.log(`Created product ${productData.title} with ID: ${productId}`);

        // 5. Add product image if available
        if (product.providerLogo && productId) {
          console.log(`Attempting image upload for ${productLog.name}`);
          const imageResult = await addProductImage(productId, product.providerLogo);
          
          results.imageResults.push({
            product: productData.title,
            success: imageResult.success,
            imageId: imageResult.imageId,
            ...(!imageResult.success && { error: imageResult.error })
          });
        } else {
          results.imageResults.push({
            product: productData.title,
            skipped: !product.providerLogo ? "No image URL" : "No product ID",
            imageUrl: product.providerLogo
          });
        }

        results.created.push(productData.title);
      } catch (err) {
        console.error(`Error processing ${productLog.name}:`, err.message);
        results.errors.push({
          product: productLog.name,
          error: err.message.replace(/\n/g, ' '),
          imageUrl: productLog.imageUrl
        });
      }

      results.processed++;
    }

    // 6. Prepare response
    const response = {
      executionTime: `${((Date.now() - startTime)/1000).toFixed(2)}s`,
      stats: {
        totalProcessed: offset + results.processed,
        created: results.created.length,
        errors: results.errors.length,
        skipped: results.skipped,
        imagesAdded: results.imageResults.filter(r => r.success).length
      },
      details: {
        created: results.created,
        errors: results.errors,
        imageResults: results.imageResults
      }
    };

    // 7. Add pagination if more products exist
    if (results.processed === CONFIG.PRODUCTS_PER_RUN && !results.skipped) {
      response.nextPage = `${event.path}?offset=${offset + results.processed}`;
    }

    console.log("Process completed:", response);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(response)
    };

  } catch (err) {
    console.error("Function execution failed:", err);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: "Function execution failed",
        message: err.message,
        executionTime: `${((Date.now() - startTime)/1000).toFixed(2)}s`,
        failedBatch: results
      })
    };
  }
};
