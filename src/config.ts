export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  naverClientId: process.env.NAVER_CLIENT_ID ?? "",
  naverClientSecret: process.env.NAVER_CLIENT_SECRET ?? "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL ?? "",
};
