import { closeHTMLTags } from "../agenticImageSearch.js";

/**
 * Emulates real-time streaming to Telegram using progressive message edits,
 * trying native sendMessageDraft first (Bot API 9.3) and falling back gracefully.
 */
export async function streamTextToTelegram(ctx: any, draftId: number, fullText: string, prefixText: string = ""): Promise<void> {
  const chatType = ctx.chat?.type;
  if (chatType && chatType !== 'private') {
    await ctx.sendChatAction("typing").catch(() => {});
    return;
  }

  const words = fullText.split(/\s+/);
  const message_thread_id = ctx.message?.message_thread_id;
  
  // Create progressive parts
  const parts: string[] = [];
  const wordsPerChunk = 6; // chunk size for streaming sensation
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    parts.push(words.slice(0, i + wordsPerChunk).join(" "));
  }

  // Guarantee the final block has the exact complete cleaned text
  if (parts.length === 0 || parts[parts.length - 1] !== fullText) {
    parts.push(fullText);
  }

  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    const body = parts[i];
    const suffix = isLast ? "" : " ▌";
    const content = prefixText ? `${prefixText}\n\n${body}${suffix}` : `${body}${suffix}`;
    const safeContent = closeHTMLTags(content);

    // 1. Send native draft progress (smooth feel)
    await ctx.telegram.callApi('sendMessageDraft' as any, {
      chat_id: ctx.chat.id,
      message_thread_id,
      draft_id: draftId,
      text: safeContent,
      parse_mode: 'HTML'
    }).catch((e: any) => {
      console.warn("⚠️ sendMessageDraft stream error:", e.message || e);
    });

    if (!isLast) {
      // Shorter interval for faster streams!
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  // Clear draft
  await ctx.telegram.callApi('sendMessageDraft' as any, {
    chat_id: ctx.chat.id,
    message_thread_id,
    draft_id: draftId,
    text: ""
  }).catch(() => {});
}

