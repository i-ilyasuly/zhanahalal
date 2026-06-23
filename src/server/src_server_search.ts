import * as fuzz from "fuzzball";
import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { FieldValue } from "firebase-admin/firestore";
import { CACHE, loadCache, db } from "./src_server_db.js";
import { escapeHTML, getDistance } from "./src_server_utils.js";
import { ai } from "./src_server_aiClient.js";

type MatchConfidence = "exact" | "fuzzy" | "none";

function writeBotLog(text: string) {
  try {
    const logPath = path.join(process.cwd(), "bot_logs.txt");
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logPath, `[${timestamp}] [searchData] ${text}\n`);
    console.log(`📝 [bot_logs.txt] ${text}`);
  } catch (e) {
    console.error("Failed to write bot log in search:", e);
  }
}

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

export function simplifyCyrillic(text: string): string {
  if (!text) return "";
  let s = text.toLowerCase();
  const replacements: Record<string, string> = {
    'ә': 'а',
    'і': 'и',
    'ң': 'н',
    'ғ': 'г',
    'ү': 'у',
    'ұ': 'у',
    'қ': 'к',
    'ө': 'о',
    'һ': 'х'
  };
  for (const [k, v] of Object.entries(replacements)) {
    s = s.split(k).join(v);
  }
  return s;
}

export function cleanForSearch(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04FF\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getVariants(text: string): string[] {
  const s = text.toLowerCase();
  const cyr2lat: Record<string, string> = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z',
    'и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r',
    'с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'c','ч':'ch','ш':'sh','щ':'sh',
    'ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya','қ':'q',
    // Kazakh Cyrillic Specific Letters
    'ә':'a','і':'i','ң':'n','ғ':'g','ү':'u','ұ':'u','ө':'o','һ':'h'
  };
  let latinVariant = "";
  for (const char of s) {
    latinVariant += cyr2lat[char] !== undefined ? cyr2lat[char] : char;
  }
  return [s, latinVariant];
}

export function isMatch(queryText: string, title: string): MatchConfidence {
  if (!title || !queryText) return 'none';

  const qClean = cleanForSearch(queryText);
  const tClean = cleanForSearch(title);

  if (!qClean || !tClean) return 'none';

  // 1. Тікелей дәл келу немесе толық substring келу
  if (tClean === qClean) return 'exact';
  if (tClean.includes(qClean)) return 'exact';

  // 2. Транслитерация арқылы тексеру
  const qLat = getVariants(qClean)[1];
  const tLat = getVariants(tClean)[1];
  if (tLat === qLat) return 'exact';
  if (tLat.includes(qLat)) return 'exact';

  // 3. Жеңілдетілген кириллица арқылы тексеру (ә -> а, і -> и т.б.)
  const qSimp = simplifyCyrillic(qClean);
  const tSimp = simplifyCyrillic(tClean);
  if (tSimp === qSimp) return 'exact';
  if (tSimp.includes(qSimp)) return 'exact';

  // 4. Сөздік-сөздік деңгейде тексеру (мысалы, "mad burge" -> "Madi Burger")
  const qWords = qClean.split(' ').filter(w => w.length >= 2);
  const tWords = tClean.split(' ').filter(w => w.length >= 2);

  if (qWords.length === 0 || tWords.length === 0) return 'none';

  const qLatWords = qLat.split(' ').filter(w => w.length >= 2);
  const tLatWords = tLat.split(' ').filter(w => w.length >= 2);

  const qSimpWords = qSimp.split(' ').filter(w => w.length >= 2);
  const tSimpWords = tSimp.split(' ').filter(w => w.length >= 2);

  let allWordsMatched = true;
  for (let i = 0; i < qWords.length; i++) {
    const qw = qWords[i];
    const qwLat = qLatWords[i] || qw;
    const qwSimp = qSimpWords[i] || qw;

    let wordMatched = false;
    for (let j = 0; j < tWords.length; j++) {
      const tw = tWords[j];
      const twLat = tLatWords[j] || tw;
      const twSimp = tSimpWords[j] || tw;

      if (
        tw.includes(qw) ||
        twLat.includes(qwLat) ||
        twSimp.includes(qwSimp)
      ) {
        wordMatched = true;
        break;
      }
    }

    if (!wordMatched) {
      allWordsMatched = false;
      break;
    }
  }

  if (allWordsMatched) {
    return 'fuzzy';
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

export function hasCompanyOrCityKeywords(queryText: string): boolean {
  const lowercase = queryText.toLowerCase();
  const companyKeywords = [
    "орын", "кафе", "дәмхана", "ресторан", "жегім келеді", "ішетін", "тамақтанатын",
    "донер", "дөнер", "бургер", "пицца", "кофе", "шай", "суши", "fast food", "фастфуд",
    "стейк", "плов", "лаунж", "бар", "кухня", "тағам", "тагам"
  ];
  const cityNames = [
    "алматы", "астана", "шымкент", "атырау", "ақтау", "актау", "ақтөбе", "актобе",
    "қарағанды", "караганды", "тараз", "павлодар", "өскемен", "усть-каменогорск",
    "семей", "орал", "уральск", "қостанай", "костанай", "қызылорда", "кызылорда",
    "түркістан", "туркистан", "көкшетау", "кокшетау", "талдықорған", "талдыкорган",
    "жезқазған", "жезказган", "петропавл", "петропавловск"
  ];

  const words = lowercase.split(/[^a-z0-9\u0400-\u04FF]/i).filter(Boolean);
  for (const word of words) {
    if (companyKeywords.includes(word) || cityNames.includes(word)) {
      return true;
    }
  }

  for (const phrase of ["жегім келеді", "ішетін жер", "тамақтанатын орын", "деген орын"]) {
    if (lowercase.includes(phrase)) {
      return true;
    }
  }

  return false;
}

export function isStrictIngredientQuery(queryText: string): boolean {
  const lowercase = queryText.toLowerCase().trim();
  
  if (/^\d{2,4}$/.test(lowercase)) {
    return true;
  }
  
  const [eBase] = parseECode(queryText);
  if (eBase !== null) {
    return true;
  }

  const chemicalSuffixes = [
    "ид", "ат", "ит", "ол", "ин", "за", "оза", "ан"
  ];
  
  const chemicalWords = [
    "су", "тұз", "сода", "желатин", "кармин", "лецитин", "глицерин", "пектин", "меланж", "пальма",
    "қышқылы", "кислота", "эмульгатор", "краситель", "консервант", "бояу", "бояғыш", "қоспа", 
    "дәмдеуіш", "стабилизатор", "антиоксидант", "керосин", "парафин", "вазелин", "стеарин",
    "токоферол", "аскорбин", "аспартам", "сахарин", "таурин", "кофеин", "глюкоза", "фруктоза",
    "сахароза", "лактоза", "мальтоза", "декстроза", "ксилит", "сорбит", "агар", "камедь", 
    "гуар", "ксантан", "іріткі", "сычуг", "реннет", "пепсин", "май", "масло", "дрожжи", "ашытқы"
  ];

  const words = lowercase.split(/[^a-z0-9\u0400-\u04FF]/i).filter(Boolean);
  
  if (words.includes("кофе") || lowercase === "кофе" || lowercase.match(/^кофе\s*(ма|ме|ба|бе|па|пе)?$/)) {
    return false;
  }

  for (const word of words) {
    if (chemicalWords.includes(word)) {
      return true;
    }
    
    if (word.length >= 5) {
      for (const suffix of chemicalSuffixes) {
        if (word.endsWith(suffix)) {
          if (!["кафе", "дүкен", "мекен", "ертен", "сеул", "бөтел"].includes(word)) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

// ── RE-IMPLEMENTED SEARCH DATA FLOW ──

export async function searchData(semanticQuery?: string, brandName?: string, city?: string, userLat?: number, userLon?: number) {
  if (!CACHE.loaded) {
    await loadCache();
  }

  const queryText = (brandName || semanticQuery || "").trim();

  // Verbose Diagnostic Logging
  writeBotLog("\n--- 🔍 [Search Diagnostic Start] ---");
  writeBotLog(`Raw Query: "${queryText}", City: "${city}"`);

  const stopWordsObj = new Set([
    'халал', 'харам', 'рұқсат', 'ма', 'ме', 'ба', 'бе', 'па', 'пе',
    'деген', 'қандай', 'осы', 'точно', 'күдікті', 'емес',
    'өнім', 'оним', 'onim', 'тамақ', 'азық', 'дүкен', 'дукен',
    'мекеме', 'өндіруші', 'сұрайын', 'айтшы', 'білгім', 'келеді',
    'жолы', 'бұлай', 'деген', 'жазады', 'жазды', 'сенен', 'маған',
    'қалай', 'калай', 'жағдай', 'жагдай', 'жағдайыңыз', 'жагдайыныз',
    'аман', 'сау', 'сәлем', 'салем', 'привет', 'кім', 'ким', 'неге',
    'қалайсың', 'қалайсыз', 'қалайсын', 'рақмет', 'рахмет'
  ]);
  const rawWordsForClean = queryText.toLowerCase().replace(/-/g, ' ').split(/\s+/);
  const processedQuery = rawWordsForClean.filter(w => !stopWordsObj.has(w)).join(" ").trim() || queryText;
  writeBotLog(`Processed Query: "${processedQuery}"`);

  const results: any[] = [];

  // ── 1. E-КОД ІЗДЕУ ───────────────────────────────────────────────────────
  if (!hasCompanyOrCityKeywords(processedQuery)) {
    const [eBase, eVariant] = parseECode(processedQuery);
    if (eBase) {
      writeBotLog(`🧪 [E-Code Match] E-код табылды: ${eBase}`);
      for (const i of CACHE.ingredients) {
        if (i.is_active === false) continue;
        const title = i.title || i.code || i._code || "";
        const name = i.name_kz || i._nameKz || "";
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
        writeBotLog(`🧪 [E-Code Results] ${results.length} қоспа табылды.`);
        writeBotLog("--- 🔍 [Search Diagnostic End] ---\n");
        return results.sort((a, b) => {
          const scoreA = a.confidence === "exact" ? 0 : 1;
          const scoreB = b.confidence === "exact" ? 0 : 1;
          return scoreA - scoreB;
        });
      }
    }
  } else {
    writeBotLog(`⏭️ [E-Code search skipped] Query contains company or city keywords.`);
  }

  // ── 2. МЕКЕМЕЛЕРДІ МӘТІН ТҮРІНДЕ ІЗДЕУ (KEYWORD & FUZZY SEARCH) ───────────
  const fuzzyResults: any[] = [];
  for (const c of CACHE.companies) {
    if (c.is_active === false) continue;
    const title = c.title || "";
    const aliases = Array.isArray(c.title_aliases) ? c.title_aliases.join(" ") : "";
    const tags = Array.isArray(c.tags) ? c.tags.join(" ") : "";
    const legal = c.legal_name || "";
    const searchField = `${title} ${aliases} ${tags}`.trim() || legal;
    if (!searchField) continue;

    const conf = isMatch(processedQuery, searchField);
    if (conf !== "none") {
      fuzzyResults.push({ 
        ...c, 
        type: "Мекеме", 
        title: c._titleStr || title, 
        confidence: conf,
        fuzzyMatch: true
      });
    }
  }

  const mergedMap = new Map<string, any>();

  for (const fr of fuzzyResults) {
    let baseScore = 50;
    const qClean = cleanForSearch(processedQuery);
    const tClean = cleanForSearch(fr.title);

    if (fr.confidence === "exact") {
      if (tClean === qClean) {
        baseScore = 200;
      } else if (tClean.startsWith(qClean)) {
        baseScore = 150;
      } else {
        baseScore = 100;
      }
    } else {
      baseScore = 50;
    }

    const cert = String(fr.certificate_status || "").trim().toLowerCase();
    if (cert === 'active' || cert.includes('белсенді') || cert.includes('актив')) {
      baseScore += 10;
    }

    mergedMap.set(String(fr.id), {
      ...fr,
      score: baseScore,
      fuzzyMatched: true
    });
  }

  let combinedCompanies = Array.from(mergedMap.values());

  if (city) {
    const cityClean = city.toLowerCase().trim();
    writeBotLog(`📍 [City Filter] Аралас нәтижелер қала бойынша сүзілуде: ${cityClean}`);
    combinedCompanies = combinedCompanies.filter(item => {
      const address = String(item.address || "").toLowerCase();
      const cityField = String(item.city || "").toLowerCase();
      return address.includes(cityClean) || cityField.includes(cityClean);
    });
    writeBotLog(`📍 [City Filter] Сүзгіден кейін қалған мекемелер саны: ${combinedCompanies.length}`);
  }

  // Сұрыптаймыз (score бойынша кему ретімен)
  combinedCompanies.sort((a, b) => b.score - a.score);

  // Геолокациялық сүзгі (Егер пайдаланушы координаттарын ұсынған болса)
  if (userLat !== undefined && userLon !== undefined && !isNaN(userLat) && !isNaN(userLon)) {
    console.log(`📍 [Location Filter] Пайдаланушы координаты бойынша қашықтық есептелуде: Lat ${userLat}, Lon ${userLon}...`);
    for (const item of combinedCompanies) {
      let itemLat: number | null = null;
      let itemLon: number | null = null;

      if (item.lat && item.lon) {
        itemLat = typeof item.lat === "string" ? parseFloat(item.lat) : item.lat;
        itemLon = typeof item.lon === "string" ? parseFloat(item.lon) : item.lon;
      } else if (item.coordinates && typeof item.coordinates === "object") {
        itemLat = item.coordinates.latitude || item.coordinates._latitude;
        itemLon = item.coordinates.longitude || item.coordinates._longitude;
      }

      if (itemLat !== null && itemLon !== null && !isNaN(itemLat) && !isNaN(itemLon)) {
        item.distanceObj = getDistance(userLat, userLon, itemLat, itemLon);
      } else {
        item.distanceObj = Infinity;
      }
    }

    combinedCompanies.sort((a, b) => {
      if (a.distanceObj !== b.distanceObj) {
        return a.distanceObj! - b.distanceObj!;
      }
      return b.score! - a.score!;
    });
  }

  // Сұрыпталған үздік 5-7 нәтижені аламыз
  const topCompanies = combinedCompanies.slice(0, 7);

  for (const c of topCompanies) {
    results.push({
      ...c,
      type: "Мекеме" // Ensure uniform type naming
    });
  }

  // ── 3. ҚОСПАЛАР ІЗДЕУ ───────────────────────────────────────────────────
  if (isStrictIngredientQuery(processedQuery) && !hasCompanyOrCityKeywords(processedQuery)) {
    console.log(`🧪 [Ingredients Search] Қоспаларды іздеу басталуда...`);
    for (const i of CACHE.ingredients) {
      if (i.is_active === false) continue;
      const title = i.code || i.title || "";
      const name = i.name_kz || "";
      const nameRu = i.name_ru || "";
      const aliases = Array.isArray(i.aliases) ? i.aliases.join(" ") : "";
      const searchName = `${name} ${nameRu} ${aliases}`.trim();

      const confTitle = title ? isMatch(processedQuery, title) : 'none';
      const confName = searchName ? isMatch(processedQuery, searchName) : 'none';

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
  } else {
    console.log(`⏭️ [Ingredients Search skipped] Not a strict ingredient query or contains company/city keywords.`);
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
    const cert = String(item.certificate_status || "").trim().toLowerCase();
    const isActive = cert === 'active' || cert.includes('белсенді') || cert.includes('актив');
    const manufacturer = escapeHTML(item.legal_name || item.title || "---");

    if (isActive) {
      return `✅ <b>«${title}»</b> — ҚМДБ Халал Даму базасында ресми тіркелген.\n\n<blockquote expandable>🏢 Өндіруші: «${manufacturer}»\n📊 Статус: ✅ Белсенді</blockquote>`;
    } else {
      return `🚫 <b>НАЗАР АУДАРЫҢЫЗ!</b>\n\n<b>«${title}»</b> мекемесінің халал сертификаты <b>МЕРЗІМІ ӨТІП КЕТКЕН!</b>\n\nБұл мекеменің қазіргі уақытта жарамды халал сертификаты жоқ. Барар алдында мекемеден тікелей сертификаттың жаңартылғанын сұраңыз.\n\n<blockquote expandable>🏢 Өндіруші: «${manufacturer}»\n📊 Статус: ❌ Мерзімі аяқталған</blockquote>`;
    }
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
