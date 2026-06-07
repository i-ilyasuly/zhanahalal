import { MyContext } from "./src_server_bot_types.js";
import { sendSearchPage, sendResultWithPhoto, sendNearbyPage } from "./src_server_bot_helpers.js";
import { getQuoteCategory, formatDetailMessage } from "./src_server_search.js";
import { getQuote } from "./src_server_quotes.js";
import { CACHE } from "./src_server_db.js";

export async function handleFeedbackAction(ctx: MyContext) {
  await ctx.answerCbQuery("Рақмет! Сіздің пікіріңіз қабылданды.", { show_alert: true }).catch(console.error);
}

export async function handleSearchPageAction(ctx: MyContext) {
  // Safe parsing since Telegraf matches regex arrays
  const match = (ctx as any).match;
  if (!match) return;

  const page = parseInt(match[1]);
  const isPhoto = parseInt(match[2]) === 1;
  const subject = ctx.session.searchSubject || '';
  
  await ctx.answerCbQuery().catch(() => {});
  await sendSearchPage(ctx, page, isPhoto, subject, ctx.callbackQuery?.message?.message_id);
}

export async function handleItemDetailAction(ctx: MyContext) {
  const match = (ctx as any).match;
  if (!match) return;

  const index = parseInt(match[1]);
  const result = ctx.session.lastResults?.[index];

  if (!result) {
    return ctx.answerCbQuery("Мәлімет ескірген. Қайта іздеп көріңіз.").catch(() => {});
  }

  await ctx.answerCbQuery().catch(() => {});
  const quote = getQuote(getQuoteCategory(result));
  await sendResultWithPhoto(ctx, result, formatDetailMessage(result) + quote);
}

export async function handleNearbyPageAction(ctx: MyContext) {
  const match = (ctx as any).match;
  if (!match) return;

  const page = parseInt(match[1]);
  await ctx.answerCbQuery().catch(() => {});
  await sendNearbyPage(ctx, page, ctx.callbackQuery?.message?.message_id);
}

export async function handleIngredientDetailAction(ctx: MyContext) {
  const match = (ctx as any).match;
  if (!match) return;

  try {
    const id = match[1];
    const item = CACHE.ingredients.find(i => i.id === id);
    if (!item) {
      return ctx.answerCbQuery("Мәлімет табылмады немесе ескірген.").catch(() => {});
    }
    await ctx.answerCbQuery().catch(() => {});
    const quote = getQuote(getQuoteCategory(item));
    const text = formatDetailMessage(item) + quote;
    await ctx.reply(text, { 
      parse_mode: 'HTML',
      ...((ctx.callbackQuery?.message as any)?.message_thread_id ? { message_thread_id: (ctx.callbackQuery?.message as any).message_thread_id } : {})
    });
  } catch (error) {
    console.error("Ingredient detail callback error:", error);
    await ctx.answerCbQuery("Қате кетті.").catch(() => {});
  }
}
