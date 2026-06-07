import { Middleware, Markup } from "telegraf";
import { MyContext } from "./src_server_bot_types.js";
import { addUser, incrementUsage } from "./src_server_db.js";
import { escapeHTML } from "./src_server_utils.js";

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
            'sendVideo', 'sendVoice', 'sendVenue', 'sendContact', 'sendPoll', 'sendDice',
            'sendMessageDraft'
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
  // Disabled per user instruct - do not spawn separate/new forum topics in group chats
  return next();
};

// Filter messages in group chats to only respond if the bot is mentioned or replied to
export const groupMentionFilterMiddleware: Middleware<MyContext> = async (ctx, next) => {
  const chatType = ctx.chat?.type;
  if (chatType && chatType !== 'private') {
    if (ctx.message) {
      const msg = ctx.message as any;
      const botUsername = ctx.botInfo?.username;
      const botId = ctx.botInfo?.id;

      let isTriggered = false;

      // 1. Check if the message is a reply to the bot's message
      if (botId && msg.reply_to_message?.from?.id === botId) {
        isTriggered = true;
      }

      // 2. Check if the message mentions the bot via text/caption
      if (!isTriggered && botUsername) {
        const text = msg.text || msg.caption || "";
        const mention = `@${botUsername}`;
        if (text.toLowerCase().includes(mention.toLowerCase())) {
          isTriggered = true;
        }
      }

      // 3. Check for specific commands targeted at this bot (e.g., /start@BotUsername)
      if (!isTriggered && botUsername && msg.text) {
        const commandMatch = msg.text.match(/^\/([a-zA-Z0-9_]+)(@([a-zA-Z0-9_]+))?/);
        if (commandMatch && commandMatch[3] && commandMatch[3].toLowerCase() === botUsername.toLowerCase()) {
          isTriggered = true;
        }
      }

      // If in a non-private chat and bot was not mentioned or replied to, ignore the update completely
      if (!isTriggered) {
        return;
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
