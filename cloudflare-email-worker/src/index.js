import PostalMime from "postal-mime";

export default {
  async email(message, env) {
    const webhookUrl = env.WEBHOOK_URL;
    const apiKey = env.NEWSLETTER_API_KEY;

    // Read raw email
    const rawEmail = await new Response(message.raw).text();

    // Parse MIME to extract text and HTML body
    const parser = new PostalMime();
    const parsed = await parser.parse(rawEmail);

    // parsed.from is a { name, address } object with the real sender info
    const fromAddr = parsed.from?.address || message.from;
    const fromName = parsed.from?.name || "";

    const payload = {
      from: fromAddr,
      from_name: fromName,
      to: message.to,
      subject: message.headers.get("subject") || "(no subject)",
      message_id: message.headers.get("message-id") || "",
      body_text: parsed.text || "",
      body_html: parsed.html || "",
    };

    const response = await fetch(`${webhookUrl}?api_key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(
        `Webhook failed: ${response.status} ${await response.text()}`
      );
    }
  },
};
