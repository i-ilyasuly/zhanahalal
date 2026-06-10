import { Markup } from "telegraf";
import fs from "fs";
import path from "path";
import { MyContext } from "./src_server_bot_types.js";
import { saveChatHistory, getChatHistory } from "./src_server_db.js";
import { searchData } from "./src_server_search.js";
import { sendResultWithPhoto, sendSearchPage } from "./src_server_bot_helpers.js";
import { autoRenameTopic } from "./src_server_bot_topicRenamer.js";
import { streamTextToTelegram } from "./src_server_bot_streamUtils.js";
import { aiClient } from "./src_server_aiClient.js";
import { Type, FunctionDeclaration } from "@google/genai";

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

const searchHalalCompaniesTool: FunctionDeclaration = {
  name: "search_halal_companies",
  description: "Халал сертификаты бар кафе, ресторан, мекеме немесе тағам түрлерін дерекқордан іздеу құралы.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      semantic_query: {
        type: Type.STRING,
        description: "тамақ, тауар немесе тақырып аты, мысалы: стейк, кофе, бургер"
      },
      brand_name: {
        type: Type.STRING,
        description: "нақты бренд атауы, мысалы: Hani, Сеул Ким, KFC"
      },
      city: {
        type: Type.STRING,
        description: "пайдаланушы сұраған нақты қала аты, мысалы: Алматы, Астана, Қарағанды, Семей"
      }
    }
  }
};

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
    
    // Save user's message to Firestore history
    await saveChatHistory(userId, 'user', query, threadId).catch(console.error);

    // Get Chat History from Firestore
    const rawHistory = await getChatHistory(userId, threadId);
    
    // Format history for Gemini SDK
    const formattedHistory = rawHistory.slice(0, -1).map((h: any) => ({
      role: h.role,
      parts: h.parts ? h.parts.map((p: any) => typeof p === 'string' ? { text: p } : p) : []
    }));

    writeBotLog(`[Agentic Chat] Starting Gemini single-chat session with ${formattedHistory.length} history items`);

    const chat = aiClient.chats.create({
      model: "gemini-2.5-flash",
      config: {
        systemInstruction: `Сен — ҚМДБ 'Халал Даму' ұйымының өте ақылды, жылы және ресми көмекшісісің. Пайдаланушымен әрқашан тірі адам сияқты, жылы қазақша (немесе орысша) тілде аңгімелесе жауап бер.
МАҢЫЗДЫ ЕРЕЖЕЛЕР:
1. ЕШҚАШАН хабарлама ішінде мекемелердің телефон нөмірлерін (phone) көрсетпе! Оларды толықтай жасыр.
2. Егер пайдаланушы сәлемдессе, жылы амандас. Бірақ әр сұрақ сайын қайталап 'Әссәләмуағалейкум' деп амандаса берме!
3. Пайдаланушы тамақ немесе мекеме іздегенде, сұранысын ақылды түрде бөліп, 'search_halal_companies' құралын semantic_query, brand_name және city параметрлерімен шақыр.
4. МЕКЕНЖАЙ БОЙЫНША АҚЫЛДЫ ТАЛДАУ (COGNITIVE RAG): Сенде мекенжайларды оқу мүмкіндігі ТОЛЫҚТАЙ БАР (ешқашан бас тартпа). Егер пайдаланушы нақты бір көшені немесе мекенжайды сұраса (мысалы, "Республика 13 мекенжайындағы хани"), алдымен бренд бойынша құралды шақыр, сосын келген нәтижелердің "address" өрістерін мұқият оқы. Сұралған мекенжай тізімде болса, intro ішінде "Иә, ... мекенжайындағы ... халал!" деп нақты жауап бер және "filtered_ids" ішіне тек сол ғана филиалдың id қалдыр. Егер болмаса, жоқ екенін айтып, басқа мекенжайларын ұсын.
5. БІР БРЕНДТІ ІЗДЕУ ЖӘНЕ СҮЗУ: Егер пайдаланушы нақты бір брендті іздесе (мысалы, "Hani"), құралдан келген нәтижелерді оқып, ТЕК сол брендке қатысты мекемелердің "id" мәндерін ғана "filtered_ids" массивіне қосып қайтар. Базалық іздеуден ілесіп кеткен басқа брендтерді немесе қатысы жоқ мекемелерді қатаң түрде фильтрлеп таста. Жалпылама тамақ іздесе (мысалы "стейк"), барлық id-лерді қайтара бер.
6. ЕГЕР search_halal_companies құралы арқылы нәтиже алсаң, жауапты МІНДЕТТІ ТҮРДЕ мынадай JSON форматында қайтар:
{"intro": "Аха, Қарағандыдағы 'Hani'-ді іздеп жатырсыз ба? Қазір қарап жіберейін...", "outro": "Мәліметтерді тексеру және статусын көру үшін төмендегі инлайн батырмаларды баса аласыз! Асыңыз дәмді болсын!", "filtered_ids": ["123", "456"]}
Markdown қажет емес, тек таза JSON. Егер құралды шақырмасаң, кәдімгі мәтін қайтара бер.`,
        tools: [{ functionDeclarations: [searchHalalCompaniesTool] }]
      },
      history: formattedHistory
    });

    // Send user message to the agent
    let response = await chat.sendMessage({ message: query });
    let functionCalls = response.functionCalls;
    let searchItems: any[] = [];
    let usedQueryForSearch = "";

    if (functionCalls && functionCalls.length > 0) {
      const call = functionCalls[0];
      if (call.name === "search_halal_companies") {
        const args = (call.args || {}) as { semantic_query?: string, brand_name?: string, city?: string };
        const sQuery = args.semantic_query;
        const bName = args.brand_name;
        const city = args.city;
        usedQueryForSearch = bName || sQuery || query;
        writeBotLog(`[Agent ToolCall] Executing search_halal_companies with generic: "${sQuery}", brand: "${bName}", city: "${city}"`);
        
        const foundItems = await searchData(sQuery, bName, city);
        searchItems = foundItems || [];
        writeBotLog(`[Agent ToolCall] searchData returned ${searchItems.length} items`);

        // Format and limit results transmitted to Gemini
        const simplifiedItems = searchItems.slice(0, 7).map(item => ({
          id: item.id,
          title: item.title,
          status: item.certificate_status,
          manufacturer: item.manufacturer,
          address: item.address,
          categories: item.categories,
          mapUrl: item.map_url || (item.latitude && item.longitude ? `https://2gis.kz/geo/${item.longitude},${item.latitude}` : "")
        }));

        // Send function execution results back to active session
        try {
          const toolResponse = await chat.sendMessage({
            message: [{
              functionResponse: {
                name: "search_halal_companies",
                response: { results: simplifiedItems }
              }
            }]
          });
          response = toolResponse;
        } catch (e: any) {
          writeBotLog(`[Agent ToolCall Error] Model crashed on receiving tool execution results: ${e.message || String(e)}`);
          // Fallback to text indicating we did the search but model failed
          response = { text: "Іздеу сәтті аяқталды, бірақ нәтижені өңдеуде қате шықты. Сізге төменде мәліметтерді ұсынамын:" } as any;
        }
      }
    }

    let finalText = response.text || "😔 Кешіріңіз, жауап дайындау кезінде қиындық туындады.";
    let finalIntro = finalText;
    let finalOutro = "";

    if (searchItems.length > 0) {
      try {
        const sanitizeJsonString = (rawText: string): string => {
          return rawText
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .trim();
        };
        let cleanedText = sanitizeJsonString(finalText);
        
        if (cleanedText.startsWith("{") || cleanedText.startsWith("[")) {
          const parsed = JSON.parse(cleanedText);
          finalIntro = parsed.intro || finalText;
          finalOutro = parsed.outro || "";
          
          if (Array.isArray(parsed.filtered_ids)) {
            const allowedIds = new Set(parsed.filtered_ids.map((id: any) => String(id)));
            searchItems = searchItems.filter(item => allowedIds.has(String(item.id)));
          }
        }
      } catch (e) {
        writeBotLog(`[JSON Parse Error] Failed to parse agent JSON: ${e}. Using raw text.`);
        finalIntro = finalText;
      }
    }

    // Append quote or style if it's single item search
    if (searchItems.length === 1) {
      const item = searchItems[0];
      ctx.session = {
        ...ctx.session,
        lastResults: [item],
        searchSubject: usedQueryForSearch,
        isPhoto: false,
        aiIntro: finalIntro,
        aiOutro: finalOutro
      };
      
      await streamTextToTelegram(ctx, draftId, finalIntro);
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const { formatDetailMessage } = await import("./src_server_search.js");
      let itemDetails = formatDetailMessage(item);
      let combinedText = `${finalIntro}\n\n${itemDetails}`;
      if (finalOutro) {
        combinedText += `\n\n${finalOutro}`;
      }
      
      await sendResultWithPhoto(ctx, item, combinedText);
      await saveChatHistory(userId, 'model', combinedText, threadId).catch(console.error);

      if (threadId) {
        autoRenameTopic(ctx, threadId, query, combinedText, 'search').catch(console.error);
      }
    } else if (searchItems.length > 1) {
      ctx.session = {
        ...ctx.session,
        lastResults: searchItems,
        searchSubject: usedQueryForSearch,
        isPhoto: false,
        aiIntro: finalIntro,
        aiOutro: finalOutro
      };

      await streamTextToTelegram(ctx, draftId, finalIntro);
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // We don't send finalIntro here immediately as a separate message
      // and skip in pagination. We WANT it inside pagination!
      
      // Offer the pagination list UI
      await sendSearchPage(ctx, 0, false, usedQueryForSearch, undefined, ""); // empty explain to let it use session intro/outro
      
      const combinedAiReply = `${finalIntro}\n\n${finalOutro}`;
      await saveChatHistory(userId, 'model', combinedAiReply, threadId).catch(console.error);

      if (threadId) {
        autoRenameTopic(ctx, threadId, query, combinedAiReply, 'search').catch(console.error);
      }
    } else {
      // General conversational flow (no matches or no search tool call)
      await streamTextToTelegram(ctx, draftId, finalText);
      await new Promise(resolve => setTimeout(resolve, 300));

      await ctx.reply(finalText, {
        parse_mode: 'HTML',
        ...(ctx.chat?.type !== 'private' && ctx.message?.message_id ? { reply_parameters: { message_id: ctx.message.message_id } } : {}),
        message_thread_id: threadId
      }).catch(console.error);

      await saveChatHistory(userId, 'model', finalText, threadId).catch(console.error);

      if (threadId) {
        autoRenameTopic(ctx, threadId, query, finalText, 'chat').catch(console.error);
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
