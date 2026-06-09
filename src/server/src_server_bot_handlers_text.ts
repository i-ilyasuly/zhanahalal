import { Markup } from "telegraf";
import fs from "fs";
import path from "path";
import { MyContext } from "./src_server_bot_types.js";
import { saveChatHistory } from "./src_server_db.js";
import { formatDetailMessage, getQuoteCategory, searchData } from "./src_server_search.js";
import { sendResultWithPhoto, sendSearchPage } from "./src_server_bot_helpers.js";
import { autoRenameTopic } from "./src_server_bot_topicRenamer.js";
import { shouldClassify, classifyQuery } from "./src_server_bot_intentClassifier.js";
import { chatWithAI, getNotFoundReply } from "./src_server_bot_aiChat.js";
import { getQuote } from "./src_server_quotes.js";
import { streamTextToTelegram } from "./src_server_bot_streamUtils.js";

function writeBotLog(text: string) {
  try {
    const logPath = path.join(process.cwd(), "bot_logs.txt");
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logPath, `[${timestamp}] ${text}\n`);
    console.log(`📝 [bot_logs.txt] ${text}`);
  } catch (e) {
    console.error("Failed to write bot log:", e);
  }
}

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
  
  try {
    const draftId = ctx.message?.message_id || Math.floor(Math.random() * 100000) + 1;
    console.log(`📩 Message from ${ctx.from?.username || userId}: ${query}`);
    writeBotLog(`📩 Incoming message from ${ctx.from?.username || userId}: "${query}"`);

    // Immediately show "Thinking..." indicator
    await ctx.sendChatAction("typing").catch(() => {});
    
    saveChatHistory(userId, 'user', query, threadId).catch(console.error);

    let searchQuery = query;
    let goToChat = false;
    let chatReply = "";

    if (shouldClassify(query)) {
      writeBotLog(`[Intent Routing] Running classification for query: "${query}"`);
      const { action, query: extractedQuery, reply: classifierReply } = await classifyQuery(query, isSymbat);
      writeBotLog(`[Intent Routing] Decision: action="${action}", query="${extractedQuery || ""}", reply="${classifierReply || ""}"`);
      if (action === "chat") {
        goToChat = true;
        chatReply = classifierReply;
      } else if (extractedQuery) {
        searchQuery = extractedQuery;
      }
    }

    if (goToChat) {
      writeBotLog(`[Chat Flow] Processing chat reply. length: ${chatReply?.length || 0}`);
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
    writeBotLog(`[DB Search] Calling searchData with search query: "${searchQuery}"`);
    const foundItems = await searchData(searchQuery);
    writeBotLog(`[DB Search] searchData returned ${foundItems?.length || 0} items.`);

    if (foundItems && foundItems.length > 0) {
      // ⚠️ ЖАҢА ВЕКТОРЛЫҚ ІЗДЕУ НӘТИЖЕЛЕРІ ҮШІН СҮЗГІНІ АЙНАЛЫП ӨТЕМІЗ (BYPASS CONFIDENCE FILTER)
      const allItems = foundItems;
      writeBotLog(`[DB Search] Vector search bypass confidence filter. Total items used directly: ${allItems.length}`);

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
    writeBotLog(`❌ [ERROR IN TEXT HANDLER]: ${err.message || String(err)}\nStack: ${err.stack || ""}`);
    console.error("Text handling error:", err);
    await ctx.reply("😔 Сұранысты өңдеу кезінде қате кетті. Сәл күте тұрып қайталап көріңіз.", {
      message_thread_id: threadId,
      ...(ctx.chat?.type !== 'private' && ctx.message?.message_id ? { reply_parameters: { message_id: ctx.message.message_id } } : {})
    }).catch(() => {});
  }
}
