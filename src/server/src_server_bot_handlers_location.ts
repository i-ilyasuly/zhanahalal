import { MyContext } from "./src_server_bot_types.js";
import { findNearbyCompanies } from "./src_server_search.js";
import { sendNearbyPage } from "./src_server_bot_helpers.js";
import { autoRenameTopic } from "./src_server_bot_topicRenamer.js";

export async function handleLocationMessage(ctx: MyContext) {
  if (!ctx.message || !('location' in ctx.message)) return;
  const lat = ctx.message.location.latitude;
  const lon = ctx.message.location.longitude;
  
  const replyOpts = {
    ...(ctx.chat?.type !== 'private' && ctx.message?.message_id ? { reply_parameters: { message_id: ctx.message.message_id } } : {})
  };
  
  const processingMsg = await ctx.reply("🔍 Сізге жақын халал мекемелерді іздеудемін...", replyOpts);
  
  try {
    const nearby = await findNearbyCompanies(lat, lon, 10);
    ctx.session.nearbyResults = nearby;
    
    await ctx.deleteMessage(processingMsg.message_id).catch(() => {});

    if (nearby.length === 0) {
      if (ctx.message.message_thread_id) {
        autoRenameTopic(
          ctx,
          ctx.message.message_thread_id,
          "📍 Айналадағы жақын орындар",
          "Пайдаланушы орналасқан жерін жіберді, бірақ 10 км радиуста ешқандай халал мекеме табылмады.",
          'search'
        ).catch(console.error);
      }
      return ctx.reply("Кешіріңіз, 10 км радиуста халал мекемелер табылдамады.", replyOpts);
    }

    if (ctx.message.message_thread_id) {
      autoRenameTopic(
        ctx,
        ctx.message.message_thread_id,
        "📍 Айналадағы жақын орындар",
        `Пайдаланушы орналасқан жерін жіберді. Маңынан 10 км радиустағы халал кафелер мен мейрамханалар ізделді. Барлығы ${nearby.length} мекеме табылды.`,
        'search'
      ).catch(console.error);
    }

    await sendNearbyPage(ctx, 0);
  } catch (error) {
    console.error("Location search error:", error);
    await ctx.deleteMessage(processingMsg.message_id).catch(() => {});
    ctx.reply("Іздеу кезінде қате кетті. Кейінірек қайталап көріңіз.", replyOpts);
  }
}
