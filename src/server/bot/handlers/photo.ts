import { Markup } from "telegraf";
import { MyContext } from "../types.js";
import { executeAgenticImageSearch, streamTextToTelegram } from "../../agenticImageSearch.js";
import { getQuoteCategory, formatDetailMessage } from "../../search.js";
import { getQuote } from "../../quotes.js";
import { sendResultWithPhoto, sendSearchPage } from "../helpers.js";

export async function handlePhotoMessage(ctx: MyContext) {
  if (!ctx.message || !('photo' in ctx.message)) return;

  try {
    const processingMsg = await ctx.reply("📷 Суретті жасанды интеллект талдауда...");
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileId = photo.file_id;
    const fileUrl = await ctx.telegram.getFileLink(fileId);
    
    const response = await fetch(fileUrl.toString());
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Image = buffer.toString('base64');

    const result = await executeAgenticImageSearch(ctx, base64Image, processingMsg.message_id);

    if (!result || !result.success) {
      await ctx.deleteMessage(processingMsg.message_id).catch(() => {});
      await ctx.reply("😔 Кешіріңіз, суретті талдау кезінде қате кетті. Тағы да көріңіз.");
      return;
    }

    const { finalAnswer, matchedCompanies, matchedIngredients } = result;

    if (matchedCompanies.length === 0 && matchedIngredients.length === 0) {
      // Direct conversational response from Agent (no concrete db references)
      await streamTextToTelegram(ctx, processingMsg.message_id, finalAnswer, "🤖 <b>Агент талдауы:</b>");
      return;
    }

    if (matchedCompanies.length === 1) {
      // 1 exact company
      const company = matchedCompanies[0];
      const quote = getQuote(getQuoteCategory(company));
      const detailsText = formatDetailMessage(company) + quote;

      // Stream conversational commentary first into the processing message
      await streamTextToTelegram(ctx, processingMsg.message_id, finalAnswer, "🤖 <b>Агент қорытындысы:</b>");
      
      // Send the beautiful photo/card separately
      await new Promise(resolve => setTimeout(resolve, 800));
      await sendResultWithPhoto(ctx, company, detailsText);
    } 
    else if (matchedCompanies.length > 1) {
      // Multiple companies
      ctx.session.lastResults = matchedCompanies.slice(0, 10);
      ctx.session.searchSubject = matchedCompanies[0].title;
      ctx.session.isPhoto = true;

      // Stream the conversational reasoning
      await streamTextToTelegram(ctx, processingMsg.message_id, finalAnswer, "🤖 <b>Агент талдауы:</b>");
      
      // Delay briefly then print the search menu
      await new Promise(resolve => setTimeout(resolve, 800));
      await sendSearchPage(ctx, 0, true, matchedCompanies[0].title);
    } 
    else if (matchedIngredients.length > 0) {
      // Ingredients matched
      const detailButtons = matchedIngredients.map((mi, idx) => {
         const statusEmoji = mi.status === 'halal' ? '✅' : (mi.status === 'haram' ? '❌' : '⚠️');
         const styleColor = mi.status === 'halal' ? 'success' : (mi.status === 'haram' ? 'danger' : 'primary');
         return { text: `${idx + 1}. ${mi.code} ${statusEmoji}`, callback_data: `ingredient_detail_${mi.id}`, style: styleColor } as any;
      });

      const rows: any[] = [];
      for (let i = 0; i < detailButtons.length; i += 2) {
         rows.push(detailButtons.slice(i, i + 2));
      }

      // Stream the conversational analysis first
      await streamTextToTelegram(ctx, processingMsg.message_id, finalAnswer, "🤖 <b>Агент талдауы:</b>");

      // Attach the inline keyboard directly to that streamed message! Clean, zero noise!
      await new Promise(resolve => setTimeout(resolve, 500));
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        processingMsg.message_id,
        undefined,
        `🤖 <b>Агент талдауы:</b>\n\n${finalAnswer}\n\n💬 <i>Төмендегі батырмалар арқылы қоспалардың толық анықтамалығын оқыңыз:</i>`,
        {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard(rows).reply_markup
        }
      ).catch(console.error);
    }

  } catch (error) {
    console.error("handlePhotoMessage error:", error);
    const errorStr = String(error);
    if (errorStr.includes("429") || errorStr.includes("quota") || errorStr.includes("RESOURCE_EXHAUSTED")) {
      await ctx.reply("⚠️ <b>Gemini AI сұраныс лимиті уақытша таусылды.</b>\nҚазіргі уақытта тегін деңгейдегі күнделікті сұраныстар шегіне жетті (немесе сурет жіберу жиілігі тым жоғары). Сәл күте тұрып (әдетте 1 минуттан соң немесе жаңа күн басталғанда) қайтадан жіберіп көріңіз.", { parse_mode: 'HTML' });
    } else {
      await ctx.reply("😔 Суретті талдау кезінде қате кетті. Сәл күте тұрып, тағы да жіберіп көріңіз.");
    }
  }
}
