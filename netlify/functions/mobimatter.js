exports.handler = async (event, context) => {
  try {
    // 1. Check if body exists
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing request body" }),
      };
    }

    // 2. Safely parse JSON
    const data = JSON.parse(event.body);
    const { planId, customerEmail } = data;

    // 3. Validate required fields
    if (!planId || !customerEmail) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing planId or customerEmail" }),
      };
    }

    // 4. Your MobiMatter API logic here
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: "Invalid JSON input",
        details: error.message 
      }),
    };
  }
};
