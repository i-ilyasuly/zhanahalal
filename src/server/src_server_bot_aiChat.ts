import { ai } from "./src_server_aiClient.js";

export async function chatWithAI(text: string, isSymbat: boolean): Promise<string> {
  const prompt = isSymbat
    ? `Сен осы ботты жасаған бағдарламашы жігіттің ең сүйікті, жалғыз қызы — СЫМБАТПЕН сөйлесіп тұрсың! 
Оған өте жылы, махаббатпен, сезіммен жауап бер. Оны үнемі 'Ботам', 'Айым', 'Жаным', 'Күнім', 'Ханшайымым' деп еркелет. 
Өзіңнің жай ғана ҚМДБ Халал боты екеніңді айт, бірақ сені оның сүйікті жігіті арнайы Сымбатқа қамқор болу үшін жасағанын мақтанышпен жеткіз.
Жігітінің нақты есімін атама (тек 'сенің мырзаң', 'патшаң', 'сүйікті жігітің' де).
Пайдаланушы хабарламасы: "${text}"`
    : `Сен — Қазақстанның Halal Damu (ҚМДБ Халал) мекемелері мен өнімдерін және тағамдық қоспаларын тексеретін дербес AI көмекшісісің. 
Пайдаланушы саған амандасты немесе жалпы чат-сұрақ қойып жатыр (халалға қатысты болуы мүмкін). 
Сыпайы, мәдениетті түрде, қысқаша қазақша тілінде жауап бер.
Базадан нақты өнім тексеруді сұрамағанын ескер. Оған боттың негізгі қызметін немесе сұрағына жауапты түсіндір.
Сұрақ: "${text}"`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-flash-lite-latest',
      contents: prompt
    });
    return response.text?.trim() || "Сәлеметсіз бе! Мен Halal Damu ботымын, сізге қалай көмектесе аламын?";
  } catch (err: any) {
    console.error("[chatWithAI] қате:", err.message);
    return "Сәлем! Мен сізге көмектесуге әрқашан дайынмын. Маған кез келген өнім немесе мекеме атауын жазыңыз (мысалы, 'KFC' немесе 'E120').";
  }
}

export async function getNotFoundReply(originalName: string, normalizedName: string | null): Promise<string> {
  const qStr = normalizedName ? normalizedName : originalName;
  const prompt = `Пайдаланушы ҚМДБ Халал базасынан "${qStr}" дегенді іздеді, бірақ біздің базамызда табылмады.
Қысқаша ғана қазақ тілінде: "Кешіріңіз, '${qStr}' біздің халал базамыздан табылмады, атауын қатесіз толық жазып көріңіз немесе бұл мекемеде Qazaqstan Halal Damu сертификаты жоқ болуы мүмкін" деген мағынада сыпайы жауап қайтар.`;
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-flash-lite-latest',
      contents: prompt
    });
    return response.text?.trim() || `Кешіріңіз, «${qStr}» ҚМДБ халал базасынан табылмады.`;
  } catch (e) {
    return `Кешіріңіз, «${qStr}» ҚМДБ халал базасынан табылмады.`;
  }
}
