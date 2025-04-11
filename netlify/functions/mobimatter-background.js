const fetch = require('node-fetch');
const { SHOPIFY_ADMIN_API_KEY, SHOPIFY_STORE_DOMAIN } = process.env;

async function createProduct(productData) {
    const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-04/products.json`;
    
    // Prepare metafields
    const metafields = [
        {
            namespace: 'esim',
            key: 'provider_logo',
            value: productData.providerLogoUrl,
            valueType: 'file', // File type for image URL
        },
        {
            namespace: 'esim',
            key: 'countries',
            value: productData.countries.join('\n'), // Multi-line text field for country codes
            valueType: 'multi_line_text_field',
        },
        {
            namespace: 'esim',
            key: 'fiveg',
            value: productData.fiveG ? '5G' : '4G',
            valueType: 'single_line_text_field', // Single-line text for 5G/4G info
        },
        {
            namespace: 'esim',
            key: 'topup',
            value: productData.topupAvailability ? 'Available' : 'Not Available',
            valueType: 'single_line_text_field',
        },
        {
            namespace: 'esim',
            key: 'validity',
            value: `${productData.validity} days`,
            valueType: 'single_line_text_field',
        },
        {
            namespace: 'esim',
            key: 'data_limit',
            value: `${productData.dataLimit} GB`,
            valueType: 'single_line_text_field',
        }
    ];

    const body = JSON.stringify({
        product: {
            title: productData.title,
            handle: productData.handle,
            body_html: productData.descriptionHtml,
            vendor: productData.vendor,
            product_type: productData.productType,
            tags: productData.tags,
            published: true,
            metafields: metafields,
        }
    });

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_KEY,
        },
        body: body,
    });

    const data = await response.json();
    return data;
}

async function syncProducts() {
    // Example product data (from Mobimatter API or elsewhere)
    const productData = {
        title: 'Montenegro 1 TB',
        handle: 'mobimatter-1tb',
        descriptionHtml: '<h1>Best Deal for Montenegro</h1>',
        vendor: 'Mtel',
        productType: 'eSIM',
        tags: ['5G', 'data-1000GB', 'country-ME'],
        providerLogoUrl: 'https://mobimatterstorage.blob.core.windows.net/mobimatter-assests/assets/mtel.png',
        countries: ['ME'],
        fiveG: true,
        topupAvailability: false,
        validity: 720,
        dataLimit: 1000,
    };

    const result = await createProduct(productData);
    console.log('Product created:', result);
}

syncProducts();
