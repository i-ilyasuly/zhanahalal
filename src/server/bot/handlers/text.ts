import { Markup } from "telegraf";
import { MyContext } from "../types.js";
import { saveChatHistory } from "../../db.js";
import { formatDetailMessage, getQuoteCategory, searchData } from "../../search.js";
import { sendResultWithPhoto, sendSearchPage } from "../helpers.js";
import { autoRenameTopic } from "../topicRenamer.js";
import { shouldClassify, classifyQuery } from "../classifier.js";
import { chatWithAI, getNotFoundReply } from "../aiChat.js";

export async function handleTextMessage(ctx: MyContext) {
  const query = ctx.message && ('text' in ctx.message) ? ctx.message.text : "";
  if (!query) return;

  if (query === "📍 Айналадағы халал мекемелер") {
    return ctx.reply(
      "📍 Айналадағы халал мекемелерді іздеу үшін ұялы телефоннан осы батырманы басыңыз немесе өз орналасқан жеріңізді (Location) жіберіңіз.\n\nКоманда: /start батырманы қайта шығару үшін.",
      Markup.keyboard([
        Markup.button.locationRequest("📍 Айналадағы халал мекемелер")
      ]).resize()
    );
  }
  
  console.log(`📩 Message from ${ctx.from?.username || ctx.from?.id}: ${query}`);
  const userId = ctx.from?.id || 0;
  const isSymbat = userId === 1042456426;

  const draftId = ctx.message?.message_id || Date.now();
  const threadId = ctx.message?.message_thread_id;
  
  ctx.sendChatAction("typing").catch(() => {});
  
  (ctx.telegram as any).callApi('sendMessageDraft', {
    chat_id: ctx.chat?.id,
    draft_id: draftId,
    message_thread_id: threadId,
    text: '⏳ <i>Жауап іздеуде...</i>',
    parse_mode: 'HTML'
  }).catch(() => {});

  const clearDraft = () => {
    if (draftId) {
      (ctx.telegram as any).callApi('sendMessageDraft', {
        chat_id: ctx.chat?.id,
        draft_id: draftId.toString(),
        text: ''
      }).catch(() => {});
    }
  };

  saveChatHistory(userId, 'user', query, threadId).catch(console.error);

  try {
    let searchQuery = query;
    let goToChat = false;

    if (shouldClassify(query)) {
      const { action, query: extractedQuery } = await classifyQuery(query);
      if (action === "chat") {
        goToChat = true;
      } else if (extractedQuery) {
        searchQuery = extractedQuery;
      }
    }

    if (goToChat) {
      const aiReply = await chatWithAI(query, isSymbat);
      await saveChatHistory(userId, 'model', aiReply, threadId).catch(console.error);
      
      if (threadId) {
        autoRenameTopic(ctx, threadId, query, aiReply).catch(console.error);
      }
      
      const extra: any = {
        parse_mode: 'HTML' as const,
        reply_markup: Markup.inlineKeyboard([
          { text: "👍 Пайдалы", callback_data: "fb_good_ai", style: "success" } as any,
          { text: "👎 Қате", callback_data: "fb_bad_ai", style: "danger" } as any
        ]).reply_markup,
        reply_parameters: { message_id: ctx.message?.message_id }
      };

      if (threadId !== undefined) {
        extra.message_thread_id = threadId;
      }

      await ctx.reply(aiReply, extra);
      clearDraft();
      return;
    }

    // ── DIRECT DB SEARCH (No AI overhead just for searching!) ──
    const foundItems = await searchData(searchQuery);

    if (foundItems && foundItems.length > 0) {
      const exactItems = foundItems.filter((i: any) => i.confidence === 'exact');
      const fuzzyItems = foundItems.filter((i: any) => i.confidence === 'fuzzy');
      const allItems = [...exactItems, ...fuzzyItems];

      if (allItems.length === 1) {
        const item = allItems[0];
        const formattedText = formatDetailMessage(item);
        
        // Append fuzzy note if applicable
        const finalText = item.confidence === 'fuzzy' 
          ? `⚠️ <i>Бұл сіз іздегенге ең ұқсас нәтиже:</i>\n\n${formattedText}`
          : formattedText;

        await sendResultWithPhoto(ctx, item, finalText);
        await saveChatHistory(userId, 'model', finalText, threadId).catch(console.error);
        if (threadId) {
          autoRenameTopic(ctx, threadId, query, finalText).catch(console.error);
        }
      } else {
        ctx.session = { lastResults: allItems, searchSubject: searchQuery, isPhoto: false };
        await sendSearchPage(ctx, 0, false, searchQuery, undefined);
        await saveChatHistory(userId, 'model', `Көп нәтиже табылды (${allItems.length})`, threadId).catch(console.error);
        if (threadId) {
          autoRenameTopic(ctx, threadId, query, `Бәлкім сіз мына мекемелерді іздеген боларсыз: ${searchQuery}`).catch(console.error);
        }
      }
      clearDraft();
      return;
    }

    // ── NOT FOUND ──
    const notFoundReply = await getNotFoundReply(query, searchQuery !== query ? searchQuery : null);
    
    await saveChatHistory(userId, 'model', notFoundReply, threadId).catch(console.error);
    if (threadId) {
      autoRenameTopic(ctx, threadId, query, notFoundReply).catch(console.error);
    }
    
    const extra: any = {
      parse_mode: 'HTML' as const,
      reply_parameters: { message_id: ctx.message?.message_id }
    };

    if (threadId !== undefined) {
      extra.message_thread_id = threadId;
    }

    await ctx.reply(notFoundReply, extra);
    clearDraft();
    
  } catch (err: any) {
    console.error("Text handling error:", err);
    await ctx.reply("😔 Сұранысты өңдеу кезінде қате кетті. Сәл күте тұрып қайталап көріңіз.", {
      message_thread_id: threadId
    }).catch(() => {});
    clearDraft();
  }
}

