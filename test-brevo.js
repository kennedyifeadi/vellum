const { BrevoClient } = require('@getbrevo/brevo');
require('dotenv').config({ path: '.env.local' });

async function test() {
  try {
    const client = new BrevoClient({ 
      apiKey: process.env.BREVO_API_KEY
    });

    const res = await client.transactionalEmails.sendTransacEmail({
      subject: "Test Brevo",
      htmlContent: "<p>Test</p>",
      sender: { name: "Vellum Support", email: process.env.EMAIL_USER },
      to: [{ email: process.env.EMAIL_USER }],
    });
    console.log("Success:", res);
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
