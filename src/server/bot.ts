import { Telegraf, session, Markup } from "telegraf";
import { MyContext } from "./bot/types.js";
import { 
  sessionSafetyMiddleware, 
  businessMessageMiddleware,
  groupMentionFilterMiddleware,
  autoForumTopicMiddleware,
  forumTopicMiddleware, 
  trackingMiddleware 
} from "./bot/middlewares.js";
import { 
  handleTextMessage 
} from "./bot/handlers/text.js";
import { 
  handleLocationMessage 
} from "./bot/handlers/location.js";
import { 
  handlePhotoMessage 
} from "./bot/handlers/photo.js";
import { 
  handleFeedbackAction, 
  handleSearchPageAction, 
  handleItemDetailAction, 
  handleNearbyPageAction, 
  handleIngredientDetailAction 
} from "./bot/handlers/callbacks.js";

const rawToken = process.env.BOT_TOKEN?.trim() || "";
let token = rawToken;

// FIX: If the token contains multiple colons (e.g. ID:ID:SECRET), take the unique ID and the Secret
if (token.includes(":")) {
  const parts = token.split(":");
  if (parts.length > 2 && parts[0] === parts[1]) {
    token = `${parts[0]}:${parts[2]}`;
    console.log("🛠 [Telegraf Architecture] Auto-fixed duplicated ID in BOT_TOKEN.");
  }
}

if (!token || token === "dummy") {
  console.error("❌ BOT_TOKEN is missing or empty. Bot will not start.");
}

export const bot = new Telegraf<MyContext>(token || "dummy");

// --- Global Error Handling ---
bot.catch((err, ctx) => {
  console.error(`❌ Bot Error for updateId ${ctx.update.update_id}:`, err);
  const replyOpts = {
    ...(ctx.chat?.type !== 'private' && ctx.message?.message_id ? { reply_parameters: { message_id: ctx.message.message_id } } : {})
  } as any;
  ctx.reply("Кешіріңіз, сұранысты өңдеу кезінде қате кетті. Сәлден соң қайталап көріңіз.", replyOpts).catch(console.error);
});

// --- Midllewares ---
bot.use(session());
bot.use(sessionSafetyMiddleware);
bot.use(businessMessageMiddleware);
bot.use(groupMentionFilterMiddleware);
bot.use(autoForumTopicMiddleware);
bot.use(forumTopicMiddleware);
bot.use(trackingMiddleware);

// --- Standard Handlers (Start & Triggers) ---
bot.start((ctx) => {
  const replyOpts = {
    ...(ctx.chat?.type !== 'private' && ctx.message?.message_id ? { reply_parameters: { message_id: ctx.message.message_id } } : {})
  } as any;
  
  ctx.reply(
    "Ассалаумағалейкум! Бұл Halal Damu боты. Өнімнің немесе қоспаның атын жазыңыз немесе суретін жіберіңіз.",
    {
      reply_markup: Markup.keyboard([
        [Markup.button.locationRequest("📍 Менің орнымды жіберу")],
        ["📍 Айналадағы халал мекемелер"]
      ]).resize().reply_markup,
      ...replyOpts
    }
  );
});

// --- Message Handlers ---
bot.on('text', handleTextMessage);
bot.on('location', handleLocationMessage);
bot.on('photo', handlePhotoMessage);

// --- Callback Query Handlers ---
bot.action(/^(fb_good_ai|fb_bad_ai)$/, handleFeedbackAction);
bot.action(/^search_page_(\d+)_(\d+)$/, handleSearchPageAction);
bot.action(/^item_(\d+)$/, handleItemDetailAction);
bot.action(/^nearby_page_(\d+)$/, handleNearbyPageAction);
bot.action(/^ingredient_detail_(.+)$/, handleIngredientDetailAction);
