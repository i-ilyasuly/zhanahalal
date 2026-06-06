import { Markup } from "telegraf";
import { MyContext } from "./types.js";
import { getQuoteCategory, formatDetailMessage } from "../search.js";
import { getQuote } from "../quotes.js";
import { escapeHTML } from "../utils.js";

export function getMapKeyboard(item: any) {
  if (item.type === "Мекеме" && item.address && item.address !== "---") {
    let mapUrl = item.map_link || "";
    if (!mapUrl && item.coordinates?.lat && item.coordinates?.lng) {
        mapUrl = `https://yandex.kz/maps/?text=${item.coordinates.lat},${item.coordinates.lng}`;
    }
    if (!mapUrl) {
        mapUrl = `https://yandex.kz/maps/?text=${encodeURIComponent(item.address)}`;
    }
    return Markup.inlineKeyboard([
      { text: "📍 Картадан көру", url: mapUrl, style: "primary" } as any
    ]).reply_markup;
  }
  return undefined;
}

export function extractImgUrl(imgObj: any): string | undefined {
  if (typeof imgObj === 'string' && imgObj.startsWith('http')) return imgObj;
  if (imgObj && typeof imgObj === 'object') {
    const url = imgObj.full || imgObj.thumbnail || imgObj.url;
    if (typeof url === 'string' && url.startsWith('http')) return url;
  }
  return undefined;
}

export async function sendResultWithPhoto(ctx: MyContext, result: any, text: string) {
  let photoUrl = extractImgUrl(result.featured_image) || extractImgUrl(result.logo_image);
  if (!photoUrl && Array.isArray(result.photos) && result.photos.length > 0) {
    photoUrl = extractImgUrl(result.photos[0]);
  }

  // Determine effect based on status
  const category = getQuoteCategory(result);
  let effectId = "";
  if (category === "halal") {
    effectId = "5046509860389126442"; // 🎉 Confetti
  } else if (category === "expired" || category === "haram") {
    effectId = "5104841245755180586"; // 🔥 Fire
  }

  const opts = {
    parse_mode: 'HTML' as const,
    reply_markup: getMapKeyboard(result),
    message_effect_id: effectId || undefined
  } as any;

  try {
    if (photoUrl && text.length <= 1024) {
      await ctx.replyWithPhoto(photoUrl, { caption: text, ...opts });
    } else if (photoUrl) {
      await ctx.replyWithPhoto(photoUrl);
      await ctx.reply(text, opts);
    } else {
      await ctx.reply(text, opts);
    }
  } catch (err: any) {
    if (err?.response?.error_code === 400 && err?.response?.description?.includes('EFFECT_ID_INVALID')) {
      console.warn("⚠️ Invalid message effect ID, retrying without effect...");
      delete opts.message_effect_id;
      
      try {
        if (photoUrl && text.length <= 1024) {
          await ctx.replyWithPhoto(photoUrl, { caption: text, ...opts });
        } else if (photoUrl) {
          await ctx.replyWithPhoto(photoUrl);
          await ctx.reply(text, opts);
        } else {
          await ctx.reply(text, opts);
        }
      } catch (retryErr) {
        console.error("❌ Retry failed:", retryErr);
        await ctx.reply(text, opts).catch(e => console.error("Fallback failed:", e));
      }
    } else {
      console.error("❌ Failed to send photo, falling back to text:", err);
      delete opts.message_effect_id; // Remove effect for fallback text just in case
      await ctx.reply(text, opts).catch(e => console.error("Fallback failed:", e));
    }
  }
}

export async function sendSearchPage(ctx: MyContext, page: number = 0, isPhoto: boolean = false, subject: string = '', messageIdToEdit?: number, aiExplanation?: string) {
  const results = ctx.session.lastResults || [];
  if (results.length === 0) return;

  const PAGE_SIZE = 5;
  const totalPages = Math.ceil(results.length / PAGE_SIZE);
  const items = results.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  let msgText = "";
  if (aiExplanation) {
    msgText += `${aiExplanation}\n\n`;
  }
  
  const searchTypeStr = isPhoto ? '📸 <b>Сурет бойынша</b>' : `🔍 <b>«${subject}» бойынша</b>`;
  msgText += `${searchTypeStr} табылды.\n\n`;
  if (!aiExplanation) {
    msgText += `<i>Бірнеше мекеме немесе филиалдар табылды (әр филиал өзінің жеке сертификатын алады). Өзіңізге қажеттісін таңдаңыз.</i>\n\n`;
  }

  const buttons = [];
  const itemButtons = [];

  items.forEach((r, index) => {
    const globalIndex = page * PAGE_SIZE + index;
    const itemNumber = globalIndex + 1;
    
    let addr = '';
    if (r.type === 'Мекеме' && r.address) {
      addr = `📍 ${r.city ? r.city + ', ' : ''}${r.address}`;
    }

    msgText += `${itemNumber}. <b>${escapeHTML(r.title || "Атаусыз")}</b>\n`;
    if (addr) {
      msgText += `${escapeHTML(addr)}\n`;
    }

    const cert = String(r.certificate_status || "").trim().toLowerCase();
    const isActive = cert === 'active' || cert === 'белсенді' || cert === 'активті' || cert === 'актив';
    if (!isActive) {
      msgText += `⚠️ <i>Сертификат мерзімі аяқталған немесе тоқтатылған!</i>\n`;
    }
    msgText += `\n`;

    itemButtons.push({
      text: `${itemNumber}`,
      callback_data: `item_${globalIndex}`,
      style: isActive ? 'success' : 'danger'
    } as any);
  });

  buttons.push(itemButtons);

  const navButtons = [];
  if (page > 0) {
    navButtons.push({ text: '⬅️ Артқа', callback_data: `search_page_${page - 1}_${isPhoto ? 1 : 0}`, style: 'primary' } as any);
  }
  if (page < totalPages - 1) {
    navButtons.push({ text: 'Келесі ➡️', callback_data: `search_page_${page + 1}_${isPhoto ? 1 : 0}`, style: 'primary' } as any);
  }

  if (navButtons.length > 0) {
    buttons.push(navButtons);
  }

  const opts: any = {
    parse_mode: 'HTML' as const,
    reply_markup: {
      inline_keyboard: buttons
    }
  };

  if (messageIdToEdit) {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      messageIdToEdit,
      undefined,
      msgText,
      opts
    ).catch(e => console.error("Edit failed:", e));
  } else {
    if (ctx.message?.message_id) {
       opts.reply_parameters = { message_id: ctx.message.message_id };
    }
    await ctx.reply(msgText, opts).catch(e => console.error("Reply failed:", e));
  }
}

export async function sendNearbyPage(ctx: MyContext, page: number, messageIdToEdit?: number) {
  const results = ctx.session.nearbyResults || [];
  if (results.length === 0) {
    return ctx.reply("Кешіріңіз, 10 км радиуста мекемелер табылмады.");
  }

  const PAGE_SIZE = 3;
  const totalPages = Math.ceil(results.length / PAGE_SIZE);
  const items = results.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  let response = `📍 <b>Айналадағы мекемелер (10 км):</b>\nБұл жерде сертификат мерзімі аяқталғандар да болуы мүмкін. Тексеріп барыңыз!\n\n📑 Бет ${page + 1}/${totalPages} (Барлығы ${results.length} мекеме)\n\n`;
  const keyboard: any[][] = [];
  
  items.forEach((c: any, index: number) => {
    const itemNumber = page * PAGE_SIZE + index + 1;
    const distStr = c.distanceObj < 1 
      ? `${(c.distanceObj * 1000).toFixed(0)} м` 
      : `${c.distanceObj.toFixed(2)} км`;
    
    const cleanTitle = (c.title || c.legal_name || "Атаусыз").replace(/["'«»]/g, '').trim();
    
    let certStatusRaw = String(c.certificate_status || "").toLowerCase().trim();
    let st = "";
    if (certStatusRaw === "active") st = "✅ Белсенді";
    else if (certStatusRaw === "expired") st = "❌ Мерзімі аяқталған";
    else if (certStatusRaw === "revoked") st = "🚫 Қайтарып алынған";
    else st = `⚠️ ${certStatusRaw}`;

    let category = "Тамақтану орындары / Мекеме";
    if (c.categories && Array.isArray(c.categories) && c.categories.length > 0) {
      category = c.categories[0].name || c.categories[0];
    } else if (c.category) {
      category = typeof c.category === 'object' ? c.category.name : c.category;
    }

    const dStart = c.certificate_date_start || "";
    const dEnd = c.certificate_date_end || "";
    const dateStr = (dStart && dEnd) ? `\n    📅 ${dStart} - ${dEnd}` : (dEnd ? `\n    📅 ${dEnd} дейін` : "");
    const icon = st.includes("Белсенді") ? "✅" : "⚠️";

    response += `${icon} <b>${itemNumber}. «${escapeHTML(cleanTitle)}»</b>\n`;
    response += `    🏷 ${escapeHTML(category)}\n`;
    response += `    📍 ${escapeHTML(c.address || c.legal_address || "Мекенжай көрсетілмеген")}\n`;
    response += `    📏 ${distStr}\n`;
    response += `    📊 ${st}${dateStr}\n\n`;

    const isActive = certStatusRaw === "active" || certStatusRaw === "белсенді" || certStatusRaw === "активті" || certStatusRaw === "актив";
    const statusStyle = isActive ? "success" : "danger";

    const mapUrl = c.map_link || (c.coordinates?.lat ? `https://yandex.kz/maps/?text=${c.coordinates.lat},${c.coordinates.lng}` : `https://yandex.kz/maps/?text=${encodeURIComponent(c.address)}`);
    keyboard.push([{ text: `🗺️ ${itemNumber}. «${cleanTitle}»`, url: mapUrl, style: statusStyle }]);
  });

  const quote = getQuote("location");
  response += quote;

  const paginationRow = [];
  if (page > 0) {
    paginationRow.push({ text: "⬅️ Артқа", callback_data: `nearby_page_${page - 1}`, style: "primary" });
  }
  if (page < totalPages - 1) {
    paginationRow.push({ text: "Келесі ➡️", callback_data: `nearby_page_${page + 1}`, style: "primary" });
  }
  if (paginationRow.length > 0) {
    keyboard.push(paginationRow);
  }

  const extra = {
    parse_mode: "HTML" as const,
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: keyboard
    }
  };

  if (messageIdToEdit && ctx.chat) {
    await ctx.telegram.editMessageText(ctx.chat.id, messageIdToEdit, undefined, response, extra).catch(e => console.error(e));
  } else {
    await ctx.reply(response, extra);
  }
}
