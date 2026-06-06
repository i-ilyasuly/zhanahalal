import { Middleware, Markup } from "telegraf";
import { MyContext } from "./types.js";
import { addUser, incrementUsage } from "../db.js";
import { escapeHTML } from "../utils.js";

// Ensure session is always initialized
export const sessionSafetyMiddleware: Middleware<MyContext> = (ctx, next) => {
  ctx.session = ctx.session || {};
  return next();
};

// Telegram Business Connection Support Middleware
// Enables Threaded Mode for private chatbot messaging when connected via Telegram Business
export const businessMessageMiddleware: Middleware<MyContext> = (ctx, next) => {
  const updateAny = ctx.update as any;
  const businessMsg = updateAny.business_message || updateAny.edited_business_message;
  
  if (businessMsg) {
    // 1. Cleanly inject the business message as standard message using Object.defineProperty to bypass TS read-only checks
    Object.defineProperty(ctx, 'message', {
      value: businessMsg,
      writable: true,
      enumerable: true,
      configurable: true
    });
    
    Object.defineProperty(ctx, 'chat', {
      value: businessMsg.chat,
      writable: true,
      enumerable: true,
      configurable: true
    });
    
    const anyCtx = ctx as any;
    anyCtx.from = businessMsg.from;
    
    const connId = businessMsg.business_connection_id;
    if (connId) {
      // 2. Wrap reply methods to inject the business_connection_id dynamically
      const replyMethods = [
        'reply', 'replyWithPhoto', 'replyWithHTML', 'replyWithMarkdown', 'replyWithMarkdownV2',
        'replyWithAudio', 'replyWithDocument', 'replyWithSticker', 'replyWithVideo',
        'replyWithVideoNote', 'replyWithVoice', 'replyWithLocation', 'replyWithVenue',
        'replyWithContact', 'replyWithPoll', 'replyWithDice'
      ] as const;

      for (const method of replyMethods) {
        if (typeof anyCtx[method] === 'function') {
          const original = anyCtx[method].bind(anyCtx);
          anyCtx[method] = (firstArg: any, extra?: any, ...rest: any[]) => {
            if (typeof extra === 'object' && extra !== null) {
              if (extra.business_connection_id === undefined) {
                extra = { business_connection_id: connId, ...extra };
              }
            } else if (extra === undefined) {
              extra = { business_connection_id: connId };
            }
            return original(firstArg, extra, ...rest);
          };
        }
      }

      // 3. Intercept telegram.callApi to automatically bind business_connection_id
      const tg = ctx.telegram as any;
      if (tg && typeof tg.callApi === 'function') {
        const originalCallApi = tg.callApi.bind(tg);
        tg.callApi = function(method: string, data: any, ...rest: any[]) {
          const sendMethods = [
            'sendMessage', 'sendPhoto', 'sendLocation', 'sendDocument', 'sendAudio',
            'sendVideo', 'sendVoice', 'sendVenue', 'sendContact', 'sendPoll', 'sendDice'
          ];
          if (sendMethods.includes(method) && data && typeof data === 'object') {
            if (data.chat_id === ctx.chat?.id && data.business_connection_id === undefined) {
              data = { ...data, business_connection_id: connId };
            }
          }
          return originalCallApi(method, data, ...rest);
        };
      }
    }
  }
  return next();
};

// Auto Forum Topic Spawner Middleware
// Creates a separate conversation thread (forum topic) for every new question/query initiated in the General topic
export const autoForumTopicMiddleware: Middleware<MyContext> = async (ctx, next) => {
  // If ordinary group (not supergroup), politely warn about topic activation requirements:
  if (ctx.chat?.type === 'group' && ctx.message) {
    const isCommand = (ctx.message as any).text?.startsWith('/');
    if (!isCommand) {
      await ctx.reply("⚠️ Бұл топта тақырыптарды (topics) автоматты түрде құру мүмкін емес, себебі бұл қарапайым топ. Тақырыптарды белсендіру үшін топ баптауларынан топты супертопқа (supergroup) ауыстырыңыз, 'Тақырыптарды' баптаулардан қосыңыз және ботты топ админі қылып, 'Тақырыптарды басқару' (Manage Topics/Forum) құқығын беріңіз.").catch(console.error);
    }
  }

  if (ctx.chat?.type === 'supergroup' && ctx.message) {
    const msg = ctx.message as any;
    const threadId = msg.message_thread_id;
    // General topic is undefined or 1
    const isGeneralOrNoThread = threadId === undefined || threadId === 1;

    if (isGeneralOrNoThread) {
      const isCommand = msg.text?.startsWith('/');
      if (!isCommand) {
        let queryText = msg.text || "";
        let topicName = "Жаңа сұраныс";

        if (queryText) {
          topicName = queryText.length > 30 ? queryText.slice(0, 27) + "..." : queryText;
        } else if (msg.photo) {
          topicName = "📸 Фото талдау";
        } else if (msg.location) {
          topicName = "📍 Картамен іздеу";
        }

        try {
          // Attempt topic creation
          const topic = await ctx.telegram.createForumTopic(ctx.chat.id, topicName);
          const targetThreadId = topic.message_thread_id;

          // Forward the user's original message inside the newly spawned topic to initiate context
          await ctx.telegram.forwardMessage(ctx.chat.id, ctx.chat.id, msg.message_id, {
            message_thread_id: targetThreadId
          }).catch(err => console.error("Could not forward original message to new topic thread:", err));

          // Build link to the new topic
          const chatLink = ctx.chat.username
            ? `https://t.me/${ctx.chat.username}/${targetThreadId}`
            : `https://t.me/c/${String(ctx.chat.id).replace('-100', '')}/${targetThreadId}`;

          const optParams: any = {
            parse_mode: 'HTML',
            reply_markup: Markup.inlineKeyboard([
              { text: "Соңғы тақырыпқа өту ➡️", url: chatLink, style: "primary" } as any
            ]).reply_markup
          };
          
          if (threadId !== undefined) {
            optParams.message_thread_id = threadId;
          }

          // Reply in General topic (using original threadId) with redirect button
          await ctx.telegram.sendMessage(ctx.chat.id, `<b>«${escapeHTML(topicName)}»</b> тақырыбы құрылды. Жауап сонда дайындалуда...`, optParams);

          // Inject the target thread ID into the current update so future handles target this new topic
          msg.message_thread_id = targetThreadId;
        } catch (err: any) {
          console.error("Failed to create forum topic:", err);
          
          const errorMsg = `⚠️ <b>Жаңа тақырып (Forum Topic) құру мүмкін болмады.</b>\nӨтініш, боттың топтағы админ құқықтарын, соның ішінде <b>'Тақырыптарды басқару' (Manage Topics/Forum)</b> рұқсатының қосылғанын тексеріңіз.`;
          
          const optParams: any = { parse_mode: 'HTML' };
          if (threadId !== undefined) {
            optParams.message_thread_id = threadId;
          }
          await ctx.telegram.sendMessage(ctx.chat.id, errorMsg, optParams).catch(console.error);
        }
      }
    }
  }
  return next();
};

// Forum Topics (Message Thread ID) Support Middleware
// Wraps ctx.reply* and ctx.telegram.callApi to preserve the thread/forum topic context
export const forumTopicMiddleware: Middleware<MyContext> = (ctx, next) => {
  const cbMessage = ctx.callbackQuery?.message as any;
  const threadId = ctx.message?.message_thread_id || cbMessage?.message_thread_id;
  
  if (threadId !== undefined) {
    // 1. Wrap context-specific reply methods to inject message_thread_id
    const replyMethods = [
      'reply', 'replyWithPhoto', 'replyWithHTML', 'replyWithMarkdown', 'replyWithMarkdownV2',
      'replyWithAudio', 'replyWithDocument', 'replyWithSticker', 'replyWithVideo',
      'replyWithVideoNote', 'replyWithVoice', 'replyWithLocation', 'replyWithVenue',
      'replyWithContact', 'replyWithPoll', 'replyWithDice'
    ] as const;

    const anyCtx = ctx as any;
    for (const method of replyMethods) {
      if (typeof anyCtx[method] === 'function') {
        const original = anyCtx[method].bind(anyCtx);
        anyCtx[method] = (firstArg: any, extra?: any, ...rest: any[]) => {
          if (typeof extra === 'object' && extra !== null) {
            if (extra.message_thread_id === undefined) {
              extra = { message_thread_id: threadId, ...extra };
            }
          } else if (extra === undefined) {
            extra = { message_thread_id: threadId };
          }
          return original(firstArg, extra, ...rest);
        };
      }
    }

    // 2. Wrap telegram callApi method to automatically route all telegram.sendMessage/sendPhoto/etc to this thread if targeting the same chat
    const tg = ctx.telegram as any;
    if (tg && typeof tg.callApi === 'function') {
      const originalCallApi = tg.callApi.bind(tg);
      tg.callApi = function(method: string, data: any, ...rest: any[]) {
        const sendMethods = [
          'sendMessage', 'sendPhoto', 'sendLocation', 'sendDocument', 'sendAudio',
          'sendVideo', 'sendVoice', 'sendVenue', 'sendContact', 'sendPoll', 'sendDice',
          'sendMessageDraft'
        ];
        if (sendMethods.includes(method) && data && typeof data === 'object') {
          if (data.chat_id === ctx.chat?.id && data.message_thread_id === undefined) {
            data = { ...data, message_thread_id: threadId };
          }
        }
        return originalCallApi(method, data, ...rest);
      };
    }
  }
  return next();
};

// User & Usage Tracking Middleware
export const trackingMiddleware: Middleware<MyContext> = async (ctx, next) => {
  if (ctx.from) {
    const { id, first_name, username } = ctx.from;
    addUser(id, first_name, username).catch(err => console.error("addUser Err:", err));
    if (ctx.message || ctx.callbackQuery) {
      incrementUsage(id).catch(err => console.error("incUsage Err:", err));
    }
  }
  return next();
};
