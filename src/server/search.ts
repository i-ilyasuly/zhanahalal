import * as fuzz from "fuzzball";
import { CACHE, loadCache } from "./db.js";
import { escapeHTML, getDistance } from "./utils.js";

type MatchConfidence = "exact" | "fuzzy" | "none";

// ── PYTHON-BASED TEXT CLEANING AND VARIANT GENERATION ──

export function cleanTextPython(text: string): string {
  if (!text) return "";
  let s = String(text).toLowerCase();
  const replacements: Record<string, string> = {
    'ü': 'u', 'ö': 'o', 'ş': 'sh', 'ç': 'ch', 'ğ': 'g', 'ı': 'i',
    'ә': 'a', 'і': 'i', 'ң': 'n', 'ғ': 'g', 'ү': 'u', 'ұ': 'u',
    'қ': 'q', 'ө': 'o', 'һ': 'h'
  };
  for (const [k, v] of Object.entries(replacements)) {
    s = s.split(k).join(v);
  }
  // Keep all standard Cyrillic and Latin alphanumeric characters, remove others
  return s.replace(/[^a-z0-9\u0400-\u04FF]/gi, "");
}

export function getVariants(text: string): string[] {
  const s = text.toLowerCase();
  const cyr2lat: Record<string, string> = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z',
    'и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r',
    'с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'c','ч':'ch','ш':'sh','щ':'sh',
    'ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya','қ':'q'
  };
  let latinVariant = "";
  for (const char of s) {
    latinVariant += cyr2lat[char] !== undefined ? cyr2lat[char] : char;
  }
  return [s, latinVariant];
}

function isSubstringMatch(queryClean: string, titleClean: string): MatchConfidence {
  if (!titleClean.includes(queryClean)) {
    return 'none';
  }
  if (titleClean.startsWith(queryClean)) {
    return 'exact';
  }
  const coverage = queryClean.length / titleClean.length;
  if (coverage >= 0.6) {
    return 'exact';
  }
  return 'fuzzy';
}

export function isMatch(queryText: string, title: string): MatchConfidence {
  if (!title || !queryText) return 'none';

  const variants = getVariants(queryText);
  const tClean = cleanTextPython(title);

  // ── 1. ТІКЕЛЕЙ SUBSTRING ТЕКСЕРУ ─────────────────────────────────────
  for (const varStr of variants) {
    const vClean = cleanTextPython(varStr);
    if (vClean.length > 3) {
      const result = isSubstringMatch(vClean, tClean);
      if (result !== 'none') {
        return result;
      }
    }

    // Partial ratio
    if (fuzz.partial_ratio(varStr, title.toLowerCase()) > 80) {
      return 'exact';
    }
  }

  // ── 2. СӨЗ БОЙЫНША ТЕКСЕРУ ───────────────────────────────────────────
  const stopWords = new Set([
    'халал', 'харам', 'рұқсат', 'ма', 'ме', 'ба', 'бе', 'па', 'пе',
    'деген', 'қандай', 'осы', 'точно', 'күдікті', 'емес',
    'өнім', 'оним', 'onim', 'тамақ', 'азық', 'дүкен', 'дукен',
    'мекеме', 'өндіруші', 'сұрайын', 'айтшы', 'білгім', 'келеді',
    'жолы', 'бұлай', 'деген', 'жазады', 'жазды', 'сенен', 'маған'
  ]);
  
  const rawWords = queryText.toLowerCase().replace(/-/g, ' ').split(/\s+/);
  const words = rawWords.filter(w => w.length > 3 && !stopWords.has(w));

  for (const word of words) {
    const wVariants = getVariants(word);
    for (const wVar of wVariants) {
      const wClean = cleanTextPython(wVar);
      if (wClean.length > 3) {
        const result = isSubstringMatch(wClean, tClean);
        if (result !== 'none') {
          return result;
        }
      }
      if (fuzz.partial_ratio(wVar, title.toLowerCase()) > 80) {
        return 'exact';
      }
    }
  }

  // ── 3. ЖАЛПЫ ҰҚСАСТЫҚ (ratio) ────────────────────────────────────────
  for (const varStr of variants) {
    const vClean = cleanTextPython(varStr);
    const r = fuzz.ratio(vClean, tClean);
    if (r >= 85) return 'exact';
    if (r >= 72) return 'fuzzy';
  }

  for (const word of words) {
    const wVariants = getVariants(word);
    for (const wVar of wVariants) {
      const wClean = cleanTextPython(wVar);
      if (wClean.length >= 4) {
        const r = fuzz.ratio(wClean, tClean);
        if (r >= 83) return 'exact';
        if (r >= 70) return 'fuzzy';
      }
    }
  }

  return 'none';
}

// ── E-CODE PARSING ──

function parseECode(queryText: string): [string | null, string | null] {
  const normalized = queryText.replace(/Е/g, 'E').replace(/е/g, 'e');
  const match = normalized.match(/[eE]\s*[-_]?\s*(\d{2,4})\s*\(?([a-zA-Z])?\)?/);
  if (match) {
    const base = 'e' + match[1].toLowerCase();
    const variant = match[2] ? match[2].toLowerCase() : null;
    return [base, variant];
  }
  return [null, null];
}

function eVariantInRange(variant: string | null, titleRaw: string): boolean {
  if (!variant) {
    return true;
  }
  const rangeMatch = titleRaw.match(/\(([a-zA-Z])-([a-zA-Z])\)/);
  if (rangeMatch) {
    const start = rangeMatch[1].toLowerCase();
    const end = rangeMatch[2].toLowerCase();
    return variant.toLowerCase() >= start && variant.toLowerCase() <= end;
  }
  const singleMatch = titleRaw.trim().match(/\d+([a-zA-Z])\s*$/);
  if (singleMatch) {
    return singleMatch[1].toLowerCase() === variant.toLowerCase();
  }
  return false;
}

// ── RE-IMPLEMENTED SEARCH DATA FLOW ──

export async function searchData(queryText: string) {
  if (!CACHE.loaded) {
    await loadCache();
  }

  const results: any[] = [];

  // ── 1. E-КОД ІЗДЕУ ───────────────────────────────────────────────────────
  const [eBase, eVariant] = parseECode(queryText);
  if (eBase) {
    for (const i of CACHE.ingredients) {
      if (i.is_active === false) continue;
      const title = i.title || "";
      const name = i.name_kz || "";
      const titleNorm = cleanTextPython(title).replace(/е/g, 'e');
      const nameNorm = cleanTextPython(name).replace(/е/g, 'e');
      const baseInTitle = eBase.length > 2 && titleNorm.includes(eBase);
      const baseInName = eBase.length > 2 && nameNorm.includes(eBase);

      if (baseInTitle || baseInName) {
        if (eVariantInRange(eVariant, title)) {
          results.push({ 
            ...i, 
            type: "Қоспа", 
            title: (i.code || "") + " - " + (i.name_kz || ""), 
            confidence: 'exact' 
          });
        }
      }
    }
    if (results.length > 0) {
      return results.sort((a, b) => {
        const scoreA = a.confidence === "exact" ? 0 : 1;
        const scoreB = b.confidence === "exact" ? 0 : 1;
        return scoreA - scoreB;
      });
    }
  }

  // ── 2. МЕКЕМЕЛЕР ІЗДЕУ ───────────────────────────────────────────────────
  for (const c of CACHE.companies) {
    if (c.is_active === false) continue;
    const title = c.title || "";
    const aliases = Array.isArray(c.title_aliases) ? c.title_aliases.join(" ") : "";
    const tags = Array.isArray(c.tags) ? c.tags.join(" ") : "";
    const legal = c.legal_name || "";
    const searchField = `${title} ${aliases} ${tags}`.trim() || legal;
    if (!searchField) continue;

    const conf = isMatch(queryText, searchField);
    if (conf !== "none") {
      results.push({ 
        ...c, 
        type: "Мекеме", 
        title: c._titleStr || title, 
        confidence: conf 
      });
      if (results.length >= 20) {
        break;
      }
    }
  }

  // ── 3. ҚОСПАЛАР ІЗДЕУ ───────────────────────────────────────────────────
  for (const i of CACHE.ingredients) {
    if (i.is_active === false) continue;
    const title = i.code || i.title || "";
    const name = i.name_kz || "";
    const nameRu = i.name_ru || "";
    const aliases = Array.isArray(i.aliases) ? i.aliases.join(" ") : "";
    const searchName = `${name} ${nameRu} ${aliases}`.trim();

    const confTitle = title ? isMatch(queryText, title) : 'none';
    const confName = searchName ? isMatch(queryText, searchName) : 'none';

    let confidence: MatchConfidence = 'none';
    if (confTitle === 'exact' || confName === 'exact') {
      confidence = 'exact';
    } else if (confTitle === 'fuzzy' || confName === 'fuzzy') {
      confidence = 'fuzzy';
    } else {
      continue;
    }

    const formattedTitle = (i.code || "") + " - " + (i.name_kz || "");
    if (!results.some(r => r.title === formattedTitle)) {
      results.push({ 
        ...i, 
        type: "Қоспа", 
        title: formattedTitle, 
        confidence 
      });
    }

    if (results.length >= 20) {
      break;
    }
  }

  results.sort((a, b) => {
    const scoreA = a.confidence === "exact" ? 0 : 1;
    const scoreB = b.confidence === "exact" ? 0 : 1;
    return scoreA - scoreB;
  });

  return results;
}

// ── FORMATTER AND DETAIL GENERATORS ──

export function formatDetailMessage(item: any): string {
  const title = escapeHTML(item.title || "Unknown");

  if (item.type === "Мекеме") {
    let statusName = "---";
    if (item.status && typeof item.status === "object") {
      statusName = item.status.name || item.status.title || "---";
    } else if (item.status) {
      statusName = String(item.status);
    }
    statusName = escapeHTML(statusName);

    const certStatus = escapeHTML(item.certificate_status || "---");
    const address = escapeHTML(item.address || "---");
    const legalName = escapeHTML(item.legal_name || "---");
    return `✅ <b>«${title}»</b>\n📍 Адрес: ${address}\n📊 Сертификат: ${certStatus}\n🏢 Заңды атауы: ${legalName}`;
  } else {
    let statusEmoji = "❓";
    if (item.status === 'halal') statusEmoji = "✅";
    if (item.status === 'haram') statusEmoji = "❌";
    if (item.status === 'mushbuh') statusEmoji = "⚠️";

    const statusTextKz = item.status === 'halal' ? 'Халал' : (item.status === 'haram' ? 'Харам' : 'Күдікті');

    const code = escapeHTML(item.code || "");
    const nameKz = escapeHTML(item.name_kz || "");
    const nameRu = escapeHTML(item.name_ru || "");
    const aliases = Array.isArray(item.aliases) && item.aliases.length > 0 ? escapeHTML(item.aliases.join(", ")) : "";
    const category = escapeHTML(item.category || "Қоспа");
    const sourceType = escapeHTML(item.source_type || "Белгісіз");
    const dangerLvl = escapeHTML(item.danger_level || "Белгісіз");
    const desc = escapeHTML(item.description_clean || "");
    const reason = escapeHTML(item.status_reason || "");

    let txt = `🧪 <b>${code}</b> – <b>${nameKz}</b>\n\n`;
    txt += `${statusEmoji} <b>Статус:</b> ${statusTextKz}\n`;
    if (reason) txt += `💡 <b>Ескерту:</b> ${reason}\n`;
    txt += `\n📂 <b>Категория:</b> ${category}\n`;
    txt += `🌱 <b>Шығу тегі:</b> ${sourceType}\n`;
    txt += `⚕️ <b>Қауіптілік:</b> ${dangerLvl}\n`;
    
    if (aliases) {
       txt += `🔗 <b>Басқа атаулары:</b> ${aliases}\n`;
    }
    
    if (nameRu && nameRu !== nameKz) {
       txt += `🇷🇺 <b>Орысша атауы:</b> ${nameRu}\n`;
    }

    if (desc) {
       txt += `\n📝 <b>Түсініктеме:</b>\n${desc}`;
    }

    return txt;
  }
}

export function getQuoteCategory(item: any): string {
  if (item.type === "Мекеме") {
    const cert = String(item.certificate_status || "").toLowerCase();
    if (cert === "active" || cert.includes("белсенді") || cert.includes("актив")) return "halal";
    if (cert === "expired" || cert.includes("мерзімі өткен")) return "expired";
    if (cert === "revoked" || cert === "suspended" || cert.includes("жойылған")) return "haram";
    return "location";
  } else {
    if (item.status === "halal") return "halal";
    if (item.status === "haram") return "haram";
    if (item.status === "mushbuh") return "suspicious";
    return "halal";
  }
}

function extractCoords(link: any): [number, number] | null {
  if (typeof link !== 'string') return null;
  const match = link.match(/-?\d{2,}\.\d+/g);
  if (match && match.length >= 2) {
    const n1 = parseFloat(match[0]);
    const n2 = parseFloat(match[1]);
    if (40 <= n1 && n1 <= 55 && 46 <= n2 && n2 <= 88) return [n1, n2];
    if (40 <= n2 && n2 <= 55 && 46 <= n1 && n1 <= 88) return [n2, n1];
  }
  return null;
}

export async function findNearbyCompanies(lat: number, lon: number, radiusKm: number = 10) {
  if (!CACHE.loaded) {
    await loadCache();
  }

  const withDistance: any[] = [];

  for (const c of CACHE.companies) {
    const link = c.map_link || "";
    const coords = extractCoords(link);
    if (!coords) continue;

    const [cLat, cLon] = coords;
    const dist = getDistance(lat, lon, cLat, cLon);
    
    if (dist <= radiusKm) {
      withDistance.push({ ...c, type: "Мекеме", distanceObj: dist });
    }
  }

  withDistance.sort((a, b) => a.distanceObj - b.distanceObj);
  
  return withDistance;
}
