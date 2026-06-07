import { Markup } from "telegraf";
import { MyContext } from "../types.js";
import { saveChatHistory } from "../../db.js";
import { formatDetailMessage, getQuoteCategory, searchData } from "../../search.js";
import { sendResultWithPhoto, sendSearchPage } from "../helpers.js";
import { autoRenameTopic } from "../topicRenamer.js";
import { shouldClassify, classifyQuery } from "../intentClassifier.js";
import { chatWithAI, getNotFoundReply } from "../aiChat.js";
import { getQuote } from "../../quotes.js";
import { streamTextToTelegram } from "../streamUtils.js";

export async function handleTextMessage(ctx: MyContext) {
  let query = ctx.message && ('text' in ctx.message) ? ctx.message.text : "";
  if (!query) return;

  // Clean up bot mentions (e.g. @HalalDamu_bot) from the query text for clean searching & AI processing
  if (ctx.botInfo?.username) {
    const mentionRegex = new RegExp(`@${ctx.botInfo.username}`, 'gi');
    query = query.replace(mentionRegex, "").trim();
  }
  if (!query) return;

  const userId = ctx.from?.id || 0;
  const threadId = ctx.message?.message_thread_id;
  const isSymbat = userId === 1042456426;

  if (query === "📍 Айналадағы халал мекемелер") {
    const replyOpts = {
      ...(ctx.chat?.type !== 'private' && ctx.message?.message_id ? { reply_parameters: { message_id: ctx.message.message_id } } : {}),
      ...(threadId ? { message_thread_id: threadId } : {})
    } as any;
    
    return ctx.reply(
      "📍 Айналадағы халал мекемелерді іздеу үшін ұялы телефоннан осы батырманы басыңыз немесе өз орналасқан жеріңізді (Location) жіберіңіз.\n\nКоманда: /start батырманы қайта шығару үшін.",
      {
        reply_markup: Markup.keyboard([
          [Markup.button.locationRequest("📍 Менің орнымды жіберу")],
          ["📍 Айналадағы халал мекемелер"]
        ]).resize().reply_markup,
        ...replyOpts
      }
    );
  }
  
  console.log(`📩 Message from ${ctx.from?.username || userId}: ${query}`);

  const draftId = ctx.message?.message_id || Math.floor(Math.random() * 100000) + 1;
  
  // Immediately show "Thinking..." indicator
  if (ctx.chat?.type === 'private') {
    await ctx.telegram.callApi('sendMessageDraft' as any, {
      chat_id: ctx.chat.id,
      message_thread_id: threadId,
      draft_id: draftId,
      text: ""
    }).catch(() => {});
  } else {
    await ctx.sendChatAction("typing").catch(() => {});
  }
  
  saveChatHistory(userId, 'user', query, threadId).catch(console.error);

  try {
    let searchQuery = query;
    let goToChat = false;
    let chatReply = "";

    if (shouldClassify(query)) {
      const { action, query: extractedQuery, reply: classifierReply } = await classifyQuery(query, isSymbat);
      if (action === "chat") {
        goToChat = true;
        chatReply = classifierReply;
      } else if (extractedQuery) {
        searchQuery = extractedQuery;
      }
    }

    if (goToChat) {
      const aiReply = chatReply || await chatWithAI(query, isSymbat);
      await saveChatHistory(userId, 'model', aiReply, threadId).catch(console.error);
      
      if (threadId) {
        autoRenameTopic(ctx, threadId, query, aiReply, 'chat').catch(console.error);
      }
      
      await streamTextToTelegram(ctx, draftId, aiReply);

      await ctx.reply(aiReply, {
        parse_mode: 'HTML',
        ...(ctx.chat?.type !== 'private' && ctx.message?.message_id ? { reply_parameters: { message_id: ctx.message.message_id } } : {}),
        message_thread_id: threadId
      }).catch(console.error);
      
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
        const quote = getQuote(getQuoteCategory(item));
        const formattedText = formatDetailMessage(item) + quote;
        
        // Append fuzzy note if applicable
        const finalText = item.confidence === 'fuzzy' 
          ? `⚠️ <i>Бұл сіз іздегенге ең ұқсас нәтиже:</i>\n\n${formattedText}`
          : formattedText;

        // Stream the text first for an organic feel
        await streamTextToTelegram(ctx, draftId, finalText);
        await new Promise(resolve => setTimeout(resolve, 500));

        await sendResultWithPhoto(ctx, item, finalText);
        await saveChatHistory(userId, 'model', finalText, threadId).catch(console.error);
        if (threadId) {
          autoRenameTopic(ctx, threadId, query, finalText, 'search').catch(console.error);
        }
      } else {
        ctx.session = { lastResults: allItems, searchSubject: searchQuery, isPhoto: false };
        const replyInfo = `«${searchQuery}» бойынша бірнеше мекеме табылды (${allItems.length}). Тізім дайындалуда...`;
        await streamTextToTelegram(ctx, draftId, replyInfo);
        await new Promise(resolve => setTimeout(resolve, 300));
        await sendSearchPage(ctx, 0, false, searchQuery, undefined);
        await saveChatHistory(userId, 'model', replyInfo, threadId).catch(console.error);
        if (threadId) {
          autoRenameTopic(ctx, threadId, query, replyInfo, 'search').catch(console.error);
        }
      }
      return;
    }

    // ── NOT FOUND ──
    const notFoundReply = await getNotFoundReply(query, searchQuery !== query ? searchQuery : null);
    
    await saveChatHistory(userId, 'model', notFoundReply, threadId).catch(console.error);
    if (threadId) {
      autoRenameTopic(ctx, threadId, query, notFoundReply, 'search').catch(console.error);
    }
    
    await streamTextToTelegram(ctx, draftId, notFoundReply);

    await ctx.reply(notFoundReply, {
      parse_mode: 'HTML',
      ...(ctx.chat?.type !== 'private' && ctx.message?.message_id ? { reply_parameters: { message_id: ctx.message.message_id } } : {}),
      message_thread_id: threadId
    }).catch(console.error);
    
    
  } catch (err: any) {
    console.error("Text handling error:", err);
    await ctx.reply("😔 Сұранысты өңдеу кезінде қате кетті. Сәл күте тұрып қайталап көріңіз.", {
      message_thread_id: threadId,
      ...(ctx.chat?.type !== 'private' && ctx.message?.message_id ? { reply_parameters: { message_id: ctx.message.message_id } } : {})
    }).catch(() => {});
  }
}

