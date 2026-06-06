import { QURAN_QUOTES } from './quotesQuran.js';
import { KAZAKH_QUOTES } from './quotesKazakh.js';

const POOL: Record<string, any[]> = {};

const CATEGORIES = [
  "halal", "haram", "expired", "suspicious",
  "not_found", "location", "payment", "gift_received"
];

for (const cat of CATEGORIES) {
  const quran = QURAN_QUOTES[cat] || [];
  const kazakh = KAZAKH_QUOTES[cat] || [];
  POOL[cat] = [...quran, ...kazakh];
}

function formatQuran(q: any, lang: string): string {
  const arabic = q.arabic || "";
  const text = q[lang] || q.kz || "";
  const source = q[`source_${lang}`] || q.source_kz || "";

  const lines = [`🕌 <i>${arabic}</i>`, ""];
  if (text) lines.push(text);
  if (source) {
    lines.push("");
    lines.push(`📖 <i>${source}</i>`);
  }
  return `\n\n<blockquote expandable>${lines.join("\n")}</blockquote>`;
}

function formatKazakh(q: any, lang: string): string {
  const kz_text = q.kz || "";
  const ru_text = q.ru || "";
  const desc = q[lang === "ru" ? "description_ru" : "description"] || q.description || "";

  const main_text = lang === "kz" ? kz_text : (ru_text || kz_text);
  const lines = [`💬 <i>${main_text}</i>`];

  if (lang === "ru" && kz_text && ru_text && kz_text !== ru_text) {
    lines.unshift(`💬 <i>${kz_text}</i>`);
    lines[1] = `<i>${ru_text}</i>`;
  }

  if (desc) {
    lines.push("");
    lines.push(`<i>${desc}</i>`);
  }

  lines.push("");
  lines.push(lang === "kz" ? "📚 Толығырақ · maqal.kz" : "📚 Подробнее · maqal.kz");

  return `\n\n<blockquote expandable>${lines.join("\n")}</blockquote>`;
}

export function getQuote(category: string, lang: string = "kz"): string {
  const pool = POOL[category] || [];
  if (pool.length === 0) return "";

  const q = pool[Math.floor(Math.random() * pool.length)];
  
  if (q.type === "quran") {
    return formatQuran(q, lang);
  } else if (q.type === "kazakh_proverb") {
    return formatKazakh(q, lang);
  }
  return "";
}
