import { config } from "../config.js";

export async function sendSlackAlert(message: string): Promise<void> {
  if (!config.slackWebhookUrl) return;
  await fetch(config.slackWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });
}
