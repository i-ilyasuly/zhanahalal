import { db } from "./src_server_db.js";
import { ai } from "./src_server_aiClient.js";

const renamedTopicsLocalCache = new Set<string>();

export async function autoRenameTopic(
  ctx: any,
  threadId: number,
  query: string,
  finalAnswer: string,
  intent?: 'chat' | 'search'
) {
  if (!threadId || !ctx.chat?.id) return;
  
  if (ctx.chat?.type !== 'private') {
    return; // Don't manage or rename topics in group chats/channels
  }
  
  if (intent === 'chat') {
    console.log(`[Topic Renamer] Skipping rename for chitchat/general talk.`);
    return;
  }
  
  const cacheKey = `${ctx.chat.id}_${threadId}`;
  if (renamedTopicsLocalCache.has(cacheKey)) {
    return;
  }

  try {
    // 1. Check with Firestore
    const docRef = db.collection("renamed_topics").doc(cacheKey);
    const doc = await docRef.get();
    if (doc.exists && doc.data()?.renamed) {
      renamedTopicsLocalCache.add(cacheKey);
      return;
    }

    console.log(`[Topic Renamer] Auto-generating topic title for thread ${threadId}...`);

    const prompt = `Сен — Telegram тақырыптарының атауын жасауға арналған кәсіби редакторсың. 
Мына сұрақ пен жауапты талдап, олардың негізгі тақырыбын Big Tech (ChatGPT, Claude) стандарттарына 100% сай келетіндей жетілдіріп жаса.

ҚАТАҢ ЕРЕЖЕЛЕР:
1. ҰЗЫНДЫҒЫ: Атау қатаң түрде тек 2-3 сөзден ғана тұруы керек.
2. ФОРМАТЫ: Сұраулы сөйлем немесе етістік қолданба. Тек зат есіммен немесе атау тұлғасында жаз (мысалы: "Ораза ұстау тәртібі" немесе "Сапардағы намаз").
3. ТАЗАЛЫҚ: Ешқандай тырнақша, нүкте, үтір, сұрақ белгісін қолданба.
4. ДИЗАЙН: Тақырып атауының ең басына тақырыпқа сәйкес келетін ТЕК 1 эмодзи қос (мысалы: 📚, 🚗, 💡, 📝). Егер тақырыпқа сай эмодзи таппасаң, жай ғана тақырыпқа сай эмодзи қой.
5. ТІЛ: Тек қазақ тілінде жаз.

ҮЛГІ (Few-Shot Examples):
- Пайдаланушы: "Жолаушымын, намаз не болады?" -> 🚗 Сапардағы намаз
- Пайдаланушы: "Вейп шегу харам ба?" -> 🚭 Вейп үкімі
- Пайдаланушы: "Ораза ұстағанда тіс тазалауға бола ма?" -> 🪥 Ораза және мисуак
- Пайдаланушы: "Саудада ақшаны қалай өсімсіз аламыз?" -> 💼 Халал сауда ережесі

Сұрақ: "${query}"
Жауап: "${finalAnswer}"`;

    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt
    });

    let newName = res.text?.trim() || "";
    if (newName) {
      newName = newName.replace(/[\*_`~#|\[\]()\\-]/g, '').replace(/\s+/g, ' ').trim();
      
      // Prevent long titles from breaking layout
      if (newName.length > 50) {
        newName = newName.substring(0, 47) + "...";
      }

      if (newName.length > 1) {
        console.log(`[Topic Renamer] Renaming thread ${threadId} to "${newName}"`);
        await ctx.telegram.editForumTopic(ctx.chat.id, threadId, { name: newName }).catch((e: any) => {
          console.error(`[Topic Renamer] Telegram API editForumTopic failed: ${e.message}`);
        });

        await docRef.set({
          renamed: true,
          title: newName,
          query: query,
          updatedAt: new Date()
        }, { merge: true });

        renamedTopicsLocalCache.add(cacheKey);
      }
    }
  } catch (err: any) {
    console.error(`[Topic Renamer] Error in autoRenameTopic:`, err.message || err);
  }
}
