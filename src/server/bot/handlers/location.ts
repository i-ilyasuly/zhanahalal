import { MyContext } from "../types.js";
import { findNearbyCompanies } from "../../search.js";
import { sendNearbyPage } from "../helpers.js";

export async function handleLocationMessage(ctx: MyContext) {
  if (!ctx.message || !('location' in ctx.message)) return;
  const lat = ctx.message.location.latitude;
  const lon = ctx.message.location.longitude;
  
  const processingMsg = await ctx.reply("🔍 Сізге жақын халал мекемелерді іздеудемін...");
  
  try {
    const nearby = await findNearbyCompanies(lat, lon, 10);
    ctx.session.nearbyResults = nearby;
    
    await ctx.deleteMessage(processingMsg.message_id).catch(() => {});

    if (nearby.length === 0) {
      return ctx.reply("Кешіріңіз, 10 км радиуста халал мекемелер табылдамады.");
    }

    await sendNearbyPage(ctx, 0);
  } catch (error) {
    console.error("Location search error:", error);
    await ctx.deleteMessage(processingMsg.message_id).catch(() => {});
    ctx.reply("Іздеу кезінде қате кетті. Кейінірек қайталап көріңіз.");
  }
}
