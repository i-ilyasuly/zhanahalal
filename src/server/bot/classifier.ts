import { ai } from "../aiClient.js";

/**
 * 4+ сөз болса классификатор шақырылады.
 * 1-3 сөз — тікелей іздеу.
 */
export function shouldClassify(text: string): boolean {
  const words = text.trim().split(/\s+/);
  return words.length >= 4;
}

export async function classifyQuery(text: string): Promise<{ action: string; query: string }> {
  try {
    let prompt = `Сен — халал өнімдер базасының іздеу маршрутизаторысың.
Пайдаланушының хабарламасын оқып, БІРДЕН JSON қайтар.

═══════════════════════════════════════════
ШЫҒЫС ФОРМАТЫ — тек осы екі нұсқа
═══════════════════════════════════════════

{"action": "search", "query": "нақты атау"}
{"action": "chat", "query": ""}

═══════════════════════════════════════════
"search" — қашан таңдаймыз?
═══════════════════════════════════════════

Пайдаланушы мыналарды іздеп жатса:
- Өнім атауы: "Snickers халал ма", "Lay's жеуге болады ма"
- Мекеме атауы: "KFC рұқсат па", "Altyn Buta халал ма"
- E-қоспа коды: "E471 не", "E120 харам ба", "E150c қауіпті ме"
- Бренд + сұрақ кез-келген түрде

query өрісіне НЕ жазу керек:
✅ Тек бренд/өнім/мекеме атауын ғана жаз — 1-3 сөз
✅ E-код болса: тек кодты жаз (мысалы: "E471")
✅ Тырнақшадағы сөз болса — сол тырнақшадағы сөз

query өрісінен НЕ алып тастау керек:
❌ халал, харам, рұқсат, жарай ма, ма, ме, ба, бе
❌ өнім, тамақ, дүкен, мекеме, дәмхана
❌ білгім келеді, айтшы, сұрайын, тексер

"X емес Y" ережесі:
"пакмир емес tagam" → query: "tagam"
"tagam деп емес пакмир деп" → query: "пакмир"
Соңғы аталған атауды ал.

═══════════════════════════════════════════
"chat" — қашан таңдаймыз?
═══════════════════════════════════════════

- Амандасу: "сәлем", "қалайсыз", "привет", "қалайсың", "жақсымысың"
- Жалпы сұрақ: "халал дегеніміз не", "ботты қалай пайдаланамын"
- Ешқандай нақты өнім/мекеме атауы жоқ
- Рақмет, сау бол, пока сияқты сөздер

═══════════════════════════════════════════
МЫСАЛДАР
═══════════════════════════════════════════

"пакмир халал ма"                           → {"action":"search","query":"пакмир"}
"Snickers жесем болады ма"                 → {"action":"search","query":"Snickers"}
"KFC-тің осы жердегісі халал ма"           → {"action":"search","query":"KFC"}
"E471 қоспасы қауіпті ме"                  → {"action":"search","query":"E471"}
"tagam емес пакмир деген өнім халал ма"    → {"action":"search","query":"пакмир"}
"«rahat» кәмпиті жарай ма"                → {"action":"search","query":"rahat"}
"Lay's чипсының халал екенін білгім келеді" → {"action":"search","query":"Lay's"}
"снікерс"                                   → {"action":"search","query":"Snickers"}
"ассалаумағалейкүм"                        → {"action":"chat", "query": ""}
"сәлем"                                    → {"action":"chat", "query": ""}
"қалайсың"                                 → {"action":"chat", "query": ""}
"қалай жүрсің"                             → {"action":"chat", "query": ""}
"халал тамақ дегеніміз не"                → {"action":"chat", "query": ""}
"ботты қалай пайдаланамын"                → {"action":"chat", "query": ""}
"рақмет"                                   → {"action":"chat", "query": ""}

Пайдаланушы хабарламасы: "${text}"

ТЕК JSON қайтар, басқа ештеңе жазба:`;

    const quotedMatches = text.match(/[«»"']([\w\s\-]+)[«»"']/g);
    if (quotedMatches && quotedMatches.length > 0) {
      prompt += `\nЕскерту: Тырнақшадағы атау: ${quotedMatches.join(", ")}. Іздеу атауы осы болуы мүмкін.`;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt
    });

    let raw = response.text?.trim() || "{}";
    raw = raw.replace(/```json\s*/, '').replace(/```\s*/, '').trim();
    const result = JSON.parse(raw);
    
    return {
      action: result.action || "chat",
      query: (result.action === "search" && result.query) ? result.query.trim() : ""
    };
  } catch (e: any) {
    console.error(`[classifier] Қате: ${e.message}`);
    return { action: "search", query: text.trim() };
  }
}
