import { closeHTMLTags } from "../agenticImageSearch.js";

/**
 * Shows "typing..." action dynamically in the chat instead of using non-standard sendMessageDraft.
 */
export async function streamTextToTelegram(ctx: any, draftId: number, fullText: string, prefixText: string = ""): Promise<void> {
  // Gracefully send chat action to indicate the bot is replying
  await ctx.sendChatAction("typing").catch(() => {});
}

