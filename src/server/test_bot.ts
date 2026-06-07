import dotenv from "dotenv";
dotenv.config();

import { Telegraf } from "telegraf";

async function testBot() {
  console.log("=== Telegram Bot Test ===");
  const rawToken = process.env.BOT_TOKEN?.trim() || "";
  console.log(`Token loaded from process.env: ${rawToken ? rawToken.substring(0, 6) + "..." + rawToken.slice(-4) : "NONE"}`);
  
  let token = rawToken;
  if (token.includes(":")) {
    const parts = token.split(":");
    if (parts.length > 2 && parts[0] === parts[1]) {
      token = `${parts[0]}:${parts[2]}`;
      console.log(`Auto-fixed duplicated ID in token: ${token.substring(0, 6) + "..." + token.slice(-4)}`);
    }
  }

  if (!token) {
    console.error("❌ Error: BOT_TOKEN is missing!");
    process.exit(1);
  }

  const botInstance = new Telegraf(token);
  try {
    console.log("Sending getMe() request to Telegram APIs...");
    const me = await botInstance.telegram.getMe();
    console.log(`✅ Success! Bot is authorized.`);
    console.log(`Username: @${me.username}`);
    console.log(`ID: ${me.id}`);
    console.log(`First Name: ${me.first_name}`);
    console.log(`Can Join Groups: ${me.can_join_groups}`);
    console.log(`Supports Inline Queries: ${me.supports_inline_queries}`);
    
    console.log("Checking for active Webhook...");
    const webhookInfo = await botInstance.telegram.getWebhookInfo();
    console.log(`Webhook URL: ${webhookInfo.url || "None (Long-polling can be used)"}`);
    console.log(`Pending update count: ${webhookInfo.pending_update_count}`);
  } catch (err: any) {
    console.error("❌ Telegram Bot Test FAILED!");
    console.error("Error Code / Message:", err.message || err);
    if (err.description) {
      console.error("Description:", err.description);
    }
  }
}

testBot().catch(console.error);
