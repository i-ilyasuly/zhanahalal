import { Markup } from "telegraf";
import { MyContext } from "../types.js";
import { executeAgenticImageSearch } from "../../agenticImageSearch.js";
import { streamTextToTelegram } from "../streamUtils.js";
import { getQuoteCategory, formatDetailMessage } from "../../search.js";
import { getQuote } from "../../quotes.js";
import { sendResultWithPhoto, sendSearchPage } from "../helpers.js";
import { autoRenameTopic } from "../topicRenamer.js";

export async function handlePhotoMessage(ctx: MyContext) {
  if (!ctx.message || !('photo' in ctx.message)) return;

  try {
    const threadId = ctx.message.message_thread_id;
    const draftId = ctx.message.message_id || Math.floor(Math.random() * 100000) + 1;
    
    if (ctx.chat?.type === 'private') {
      await ctx.telegram.callApi('sendMessageDraft' as any, {
        chat_id: ctx.chat.id,
        message_thread_id: threadId,
        draft_id: draftId,
        text: ""
      }).catch(() => {});
    } else {
      await ctx.sendChatAction("typing").catch(() => {});
    }

    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileId = photo.file_id;
    const fileUrl = await ctx.telegram.getFileLink(fileId);
    
    const response = await fetch(fileUrl.toString());
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Image = buffer.toString('base64');

    const result = await executeAgenticImageSearch(ctx, base64Image, draftId);

    if (!result || !result.success) {
      await ctx.reply("😔 Кешіріңіз, суретті талдау кезінде қате кетті. Тағы да көріңіз.", { message_thread_id: threadId });
      return;
    }


    const { finalAnswer, matchedCompanies, matchedIngredients } = result;

    if (ctx.message.message_thread_id) {
      let subj = "📷 Суретті талдау";
      if (matchedCompanies.length > 0) {
        subj = matchedCompanies[0].title;
      } else if (matchedIngredients.length > 0) {
        subj = matchedIngredients[0].code || "Е-код қоспасы";
      }
      autoRenameTopic(ctx, ctx.message.message_thread_id, subj, finalAnswer, 'search').catch(console.error);
    }

    if (matchedCompanies.length === 0 && matchedIngredients.length === 0) {
      // Direct conversational response from Agent (no concrete db references)
      await streamTextToTelegram(ctx, draftId, finalAnswer);
      await ctx.reply(finalAnswer, { parse_mode: 'HTML', message_thread_id: threadId });
      return;
    }

    if (matchedCompanies.length === 1) {
      // 1 exact company
      const company = matchedCompanies[0];
      const quote = getQuote(getQuoteCategory(company));
      const detailsText = formatDetailMessage(company) + quote;

      // Stream the card text directly!
      await streamTextToTelegram(ctx, draftId, detailsText);
      
      // Send the beautiful photo/card separately
      await new Promise(resolve => setTimeout(resolve, 500));
      await sendResultWithPhoto(ctx, company, detailsText);
    } 
    else if (matchedCompanies.length > 1) {
      // Multiple companies
      ctx.session.lastResults = matchedCompanies.slice(0, 10);
      ctx.session.searchSubject = matchedCompanies[0].title;
      ctx.session.isPhoto = true;

      const replyInfo = `Суреттен «${matchedCompanies[0].title}» бойынша бірнеше мекеме табылды (${matchedCompanies.length}). Тізім дайындалуда...`;
      await streamTextToTelegram(ctx, draftId, replyInfo);
      
      // Delay briefly then print the search menu
      await new Promise(resolve => setTimeout(resolve, 500));
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

      const ingText = `🔍 Суреттен ${matchedIngredients.length} тағамдық қоспа табылды.\n\n💬 <i>Төмендегі батырмалар арқылы қоспалардың толық анықтамалығын оқыңыз:</i>`;
      await streamTextToTelegram(ctx, draftId, ingText);

      await new Promise(resolve => setTimeout(resolve, 500));
      await ctx.reply(
        ingText,
        {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard(rows).reply_markup,
          message_thread_id: threadId
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
