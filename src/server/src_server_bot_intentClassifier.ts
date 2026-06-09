import { ai } from "./src_server_aiClient.js";

export function shouldClassify(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return true;
}

export async function classifyQuery(
  text: string, 
  isSymbat: boolean = false
): Promise<{ action: "chat" | "search"; query: string; reply: string }> {
  try {
    const sysPrompt = `Сен — "Qazaqstan Halal Damu" (ҚМДБ Халал) ботының іздеу маршрутизаторы және ақылды AI көмекшісісің.
Сенің міндетің - пайдаланушы хабарламасын "жабайы" сөйлесу (chat) немесе "нақты базадан іздеу" (search) деп екіге бөлу.

МАҢЫЗДЫ ЕСКЕРТУЛЕР:
- Егер пайдаланушы кафе/ресторан/тамақтану орындарын іздесе, ұсыныс сұраса ("ұсыншы", "қайда бар", "жегім келеді", "орын бар ма", "ішетін жер", "кафе", "ресторан" т.б.) -> БҰЛ МІНДЕТТІ ТҮРДЕ "search" (іздеу) ниеті болуы тиіс. Оны "chat" қылып жіберме!
- Егер мәтінде нақты өнім, мекеме, E-код немесе кафе/ресторан тақырыбы сұралса (KFC, Snickers, E471, Bahandi, тамақтанатын орын, т.б.) -> БҰЛ "search".
- Егер мәтінде тек мынадай қарапайым сөздер болса: "сәлем", "салем", "ассалаумағалейкум", "привет", "салам", "қалайсың", "жағдайыңыз қалай", "не істеп жатсың", "рақмет", "рахмет", "күшті" -> БҰЛ МІНДЕТТІ ТҮРДЕ "action": "chat" болуы тиіс. Оны "search" қылып жіберме!

ЕГЕР "chat" болса:
- "reply" өрісіне сыпайы, өте жылы қазақ тіліндегі (эмодзилермен) қысқа жауап беріңіз. Пайдаланушымен әрқашан "Сіз" деп сөйлес.
- "query" өрісі бос "" болсын.
${isSymbat ? '\nЕСКЕРТУ (СЫМБАТПЕН СӨЙЛЕСУ): Бұл ботты жасаған бағдарламашының сүйікті қызы Сымбат жазып тұр! Оған өте жылы, махаббатпен жауап бер ("Ботам", "Айым", "Жаным"). Жігітінің атын атамай "сүйікті жігітің", "мырзаң" деп ата. Оның жігіті ботты арнайы оған қамқор болу үшін жасағанын мақтанышпен жеткіз.' : ''}

ЕГЕР "search" болса:
- "query" өрісіне: сұраудан артық сөздерді ("халал", "харам", "ма", "ме", "ба", "бе", "болады ма", "жеуге рұқсат пе") алып тастап, тек негізгі таза бренд/мекеме атауын немесе іздеу мақсатын қалдыр (мысалы: "Bal DAY халал ма" -> "Bal DAY", "KFC рұқсат па" -> "KFC", "Алматыда жақсы ресторан ұсыншы" -> "Ресторан Алматы", "Астанада қайда баруға болады" -> "Астана").
- "reply" өрісі бос "" болсын.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: text,
      config: {
        systemInstruction: sysPrompt,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            action: { type: "STRING", description: "chat немесе search" },
            query: { type: "STRING", description: "ізделетін өнім/мекеме атауы (тек search үшін)" },
            reply: { type: "STRING", description: "дайын мәтіндік жауап (тек chat үшін)" }
          },
          required: ["action", "query", "reply"]
        }
      }
    });

    let raw = response.text?.trim() || "{}";
    raw = raw.replace(/```json\s*/, '').replace(/```\s*/, '').trim();
    const result = JSON.parse(raw);
    
    // Fallback if AI gets confused:
    const lowercaseText = text.toLowerCase().trim();
    if (result.action === 'search' && (lowercaseText === 'ассалаумағалейкум' || lowercaseText === 'сәлем' || lowercaseText === 'рақмет' || lowercaseText === 'рахмет' || lowercaseText === 'привет')) {
       result.action = 'chat';
       result.reply = lowercaseText.includes('рақмет') ? "Оқасы жоқ! Тағы қандай өнімді немесе мекемені тексерейін?" : "Сәлеметсіз бе! Мен Halal Damu ботымын. Қандай өнімді немесе мекемені тексергіңіз келеді?";
       result.query = "";
    }

    return {
      action: result.action === "search" ? "search" : "chat",
      query: result.query ? result.query.trim() : "",
      reply: result.reply ? result.reply.trim() : ""
    };
  } catch (e: any) {
    console.error(`[classification error]: ${e.message}`);
    // Қателік жағдайында қауіпсіздік үшін бұрынғыша іздеу деп есептейміз
    return { action: "search", query: text.trim(), reply: "" };
  }
}
