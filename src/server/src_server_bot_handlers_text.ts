import { Markup } from "telegraf";
import fs from "fs";
import path from "path";
import { MyContext } from "./src_server_bot_types.js";
import { saveChatHistory } from "./src_server_db.js";
import { searchData } from "./src_server_search.js";
import { sendResultWithPhoto, sendSearchPage } from "./src_server_bot_helpers.js";
import { autoRenameTopic } from "./src_server_bot_topicRenamer.js";

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

  // Clean up bot mentions (e.g. @HalalDamu_bot) from the query text for clean searching
  if (ctx.botInfo?.username) {
    const mentionRegex = new RegExp(`@${ctx.botInfo.username}`, 'gi');
    query = query.replace(mentionRegex, "").trim();
  }
  if (!query) return;

  const userId = ctx.from?.id || 0;
  const threadId = ctx.message?.message_thread_id;

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
    console.log(`📩 Simple direct search from ${ctx.from?.username || userId}: ${query}`);
    writeBotLog(`📩 Incoming message from ${ctx.from?.username || userId} for direct search: "${query}"`);

    // Immediately show "Thinking..." indicator
    await ctx.sendChatAction("typing").catch(() => {});
    
    // Save user's message to Firestore history
    await saveChatHistory(userId, 'user', query, threadId).catch(console.error);

    // Сәлемдесу сөздерін тексеру
    const lowercase = query.toLowerCase().trim();
    if (["сәлем", "салем", "ассалаумағалейкум", "ассаламу алейкум", "привет", "салам", "hi", "hello"].some(greet => lowercase.includes(greet))) {
      const greetMsg = "Уағалейкум ассалам! 😊\n\nHalalDamu анықтамалық ботына қош келдіңіз. Іздеу үшін келесілерді жаза аласыз:\n\n• Кафе немесе мекеме атын (мысалы: <i>Hani</i>, <i>Сеул Ким</i>)\n• Өндірушіні немесе брендті\n• Тағамдық қоспа (E-код) нөмірін (мысалы: <i>E471</i>, <i>кармин</i>)\n\nАсыңыз дәмді, таңдауыңыз халал болсын! 🕌";
      
      await ctx.reply(greetMsg, {
        parse_mode: "HTML",
        message_thread_id: threadId,
        ...(ctx.chat?.type !== 'private' && ctx.message?.message_id ? { reply_parameters: { message_id: ctx.message.message_id } } : {})
      });
      
      await saveChatHistory(userId, 'model', greetMsg, threadId).catch(console.error);
      return;
    }

    // Direct Search
    writeBotLog(`[Direct Search] Executing searchData for query "${query}"`);
    let searchItems = await searchData(query);

    function escapeHTML(str: string): string {
      return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    let finalIntro = `«${escapeHTML(query)}» сұранысы бойынша нәтижелер:`;
    let finalOutro = "Толық ақпаратты көру үшін төмендегі инлайн батырмаларды басыңыз.";

    if (searchItems.length === 0) {
      const emptyMsg = `😔 <b>«${escapeHTML(query)}»</b> бойынша ҚМДБ Халал Даму базасынан ештеңе табылмады.\n\nСұранысты басқаша жазып көріңіз немесе басқа өнімді іздеңіз.`;
      
      await ctx.reply(emptyMsg, {
        parse_mode: 'HTML',
        ...(ctx.chat?.type !== 'private' && ctx.message?.message_id ? { reply_parameters: { message_id: ctx.message.message_id } } : {}),
        message_thread_id: threadId
      }).catch(console.error);

      await saveChatHistory(userId, 'model', emptyMsg, threadId).catch(console.error);

      if (threadId) {
        autoRenameTopic(ctx, threadId, query, emptyMsg, 'chat').catch(console.error);
      }
      return;
    }

    if (searchItems.length === 1) {
      const item = searchItems[0];
      ctx.session = {
        ...ctx.session,
        lastResults: [item],
        searchSubject: query,
        isPhoto: false,
        aiIntro: finalIntro,
        aiOutro: ""
      };
      
      const { formatDetailMessage } = await import("./src_server_search.js");
      let itemDetails = formatDetailMessage(item);
      let combinedText = `${finalIntro}\n\n${itemDetails}`;
      
      await sendResultWithPhoto(ctx, item, combinedText);
      await saveChatHistory(userId, 'model', combinedText, threadId).catch(console.error);

      if (threadId) {
        autoRenameTopic(ctx, threadId, query, combinedText, 'search').catch(console.error);
      }
    } else {
      ctx.session = {
        ...ctx.session,
        lastResults: searchItems,
        searchSubject: query,
        isPhoto: false,
        aiIntro: finalIntro,
        aiOutro: finalOutro
      };
      
      // Offer the pagination list UI
      await sendSearchPage(ctx, 0, false, query, undefined, ""); 
      
      const combinedReply = `${finalIntro}\n\n${finalOutro}`;
      await saveChatHistory(userId, 'model', combinedReply, threadId).catch(console.error);

      if (threadId) {
        autoRenameTopic(ctx, threadId, query, combinedReply, 'search').catch(console.error);
      }
    }

  } catch (err: any) {
    writeBotLog(`❌ [ERROR IN AGENT TEXT HANDLER]: ${err.message || String(err)}\nStack: ${err.stack || ""}`);
    console.error("Text handling error:", err);
    await ctx.reply("😔 Кешіріңіз, сұранысты өңдеу кезінде жүйелік қате кетті. Сәл күте тұрып қайталап көріңіз.", {
      message_thread_id: threadId,
      ...(ctx.chat?.type !== 'private' && ctx.message?.message_id ? { reply_parameters: { message_id: ctx.message.message_id } } : {})
    }).catch(() => {});
  }
}
