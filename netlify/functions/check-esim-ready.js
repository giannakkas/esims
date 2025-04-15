// netlify/functions/check-esim-ready.js
const fetch = require("node-fetch");

exports.handler = async (event, context) => {
  const { orderId, customerEmail } = JSON.parse(event.body);

  console.log("🔁 Checking if eSIM QR code is ready...");
  console.log(`→ Order ID: ${orderId}`);
  console.log(`→ Customer Email: ${customerEmail}`);

  const maxAttempts = 12; // Wait up to 1 minute (12 * 5s)
  const delay = (ms) => new Promise((res) => setTimeout(res, ms));
  const MOBIMATTER_API = "https://api.mobimatter.com/mobimatter/api/v2/order";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`🔍 Attempt ${attempt}/${maxAttempts}...`);

    const response = await fetch(`${MOBIMATTER_API}/${orderId}`);
    const json = await response.json();

    if (json?.result?.activation?.imageUrl) {
      const imageUrl = json.result.activation.imageUrl;
      console.log("✅ QR code is ready:", imageUrl);

      // Send the email using Mobimatter's built-in endpoint
      const sendEmailRes = await fetch(`${MOBIMATTER_API}/send-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderId,
          email: customerEmail,
        }),
      });

      if (sendEmailRes.ok) {
        console.log("📧 Mobimatter confirmation email sent successfully.");
      } else {
        console.error("❌ Failed to send Mobimatter email.");
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, imageUrl }),
      };
    }

    console.log("⏳ QR not ready yet. Waiting 5 seconds...");
    await delay(5000);
  }

  console.warn("⚠️ QR code was not ready in time.");
  return {
    statusCode: 408,
    body: JSON.stringify({ success: false, message: "QR not ready after timeout." }),
  };
};
