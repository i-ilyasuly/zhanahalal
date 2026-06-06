import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { searchData } from "./search.js";

let aiInstance: GoogleGenAI | null = null;

function getAI(): GoogleGenAI {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required. Please set it in the Secrets panel.");
    }
    aiInstance = new GoogleGenAI({ 
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiInstance;
}

// 1. Tool (Function) Declarations
const searchDatabaseDeclaration: FunctionDeclaration = {
  name: "searchDatabase",
  description: "Halal Damu мекемелері мен өнімдерінің дерекқорынан атау (мысалы өнім аты, бренд немесе код) бойынша іздейді. Іздеу нәтижесінде мекеме немесе қоспа туралы мәлімет қайтарылады.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: "Іздеу сұранысы (мысалы бренд атауы, өнім аты, немесе Е-код)"
      }
    },
    required: ["query"]
  }
};

const getIngredientReportDeclaration: FunctionDeclaration = {
  name: "getIngredientReport",
  description: "Суретте жазылған өнімнің құрамындағы тағамдық қоспалар (E-кодтар немесе атаулар) тізімін жинақтап тексеруге арналған. Жиым ретінде қабылдап, әр қоспаның халал/харам статусын тексереді.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      ingredients: {
        type: Type.ARRAY,
        items: {
          type: Type.STRING
        },
        description: "Тағам құрамынан табылған Е-кодтардың немесе қоспалардың тізімі (мысалы: ['E120', 'кармин', 'желатин', 'E322'])"
      }
    },
    required: ["ingredients"]
  }
};

/**
 * Executes a tool's internal logic and tracks matches for native UI presentation
 */
async function executeTool(name: string, args: any, matchedItems: any[]): Promise<any> {
  if (name === "searchDatabase") {
    const { query } = args;
    if (!query || query.length < 2) return { results: [], message: "Сұраныс тым қысқа." };

    console.log(`[Agent Tool - Calling searchDatabase] input query: "${query}"`);
    const dbResults = await searchData(query);

    // Keep tracked items for outputting inline keyboards later
    for (const r of dbResults) {
      if (!matchedItems.some(item => item.id === r.id)) {
        matchedItems.push(r);
      }
    }

    return dbResults.map(r => {
      if (r.type === "Мекеме") {
        return {
          type: "Company/Establishment",
          id: r.id,
          title: r.title,
          certificate_status: r.certificate_status,
          address: r.address,
          legal_name: r.legal_name,
          category: r.category,
        };
      } else {
        return {
          type: "Ingredient/Additive",
          id: r.id,
          code: r.code,
          name_kz: r.name_kz,
          status: r.status, // halal / haram / mushbuh
          status_reason: r.status_reason,
          source_type: r.source_type,
        };
      }
    });
  } 
  
  if (name === "getIngredientReport") {
    const { ingredients } = args;
    if (!ingredients || !Array.isArray(ingredients) || ingredients.length === 0) {
      return { report: [], message: "Қоспалар табылмады" };
    }

    console.log(`[Agent Tool - Calling getIngredientReport] inputs:`, ingredients);
    const report: any[] = [];

    for (const ing of ingredients) {
      const dbResults = await searchData(ing);
      // Filter for code/additives
      const additives = dbResults.filter(r => r.type === "Қоспа");
      
      if (additives.length > 0) {
        additives.forEach(add => {
          if (!matchedItems.some(item => item.id === add.id)) {
            matchedItems.push(add);
          }
          report.push({
            query: ing,
            found: true,
            id: add.id,
            code: add.code,
            name_kz: add.name_kz,
            status: add.status,
            status_reason: add.status_reason,
            source_type: add.source_type
          });
        });
      } else {
        report.push({
          query: ing,
          found: false,
          message: "Бұл қоспа дерекқорымызда табылмады, бірақ талдау кезінде табиғи немесе рұқсат етілген компонент болуы мүмкін."
        });
      }
    }
    return report;
  }

  throw new Error(`Анықталмаған құрал: ${name}`);
}

export function closeHTMLTags(html: string): string {
  const tags = ['b', 'i', 'code', 'pre', 'u'];
  let closed = html;
  
  // Track open tags in a LIFO stack
  const openTags: string[] = [];
  
  // Regex to find all opening or closing tags of interest
  const tagRegex = /<\/?(b|i|code|pre|u)\b[^>]*>/g;
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    const fullTag = match[0];
    const tagName = match[1];
    if (fullTag.startsWith('</')) {
      // It's a closing tag: pop if it matches the latest open tag
      if (openTags.length > 0 && openTags[openTags.length - 1] === tagName) {
        openTags.pop();
      }
    } else {
      // It's an opening tag
      openTags.push(tagName);
    }
  }
  
  // Close any unclosed tags in reverse order
  for (let i = openTags.length - 1; i >= 0; i--) {
    closed += `</${openTags[i]}>`;
  }
  
  return closed;
}

export function cleanupMarkdownToHTML(text: string): string {
  if (!text) return "";

  let cleaned = text;

  // 1. Remove markdown horizontal layout splitters
  cleaned = cleaned.replace(/^\s*[-*_]{3,}\s*$/gm, '');

  // 2. Remove standard markdown headers like ### or #### and replace with bold HTML lines
  cleaned = cleaned.replace(/^\s*#{1,6}\s*(.+)$/gm, '<b>$1</b>');

  // 3. Bold tags: **text** or __text__ to <b>text</b>
  cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
  cleaned = cleaned.replace(/__(.*?)__/g, '<b>$1</b>');

  // 4. Bullet points: '* ' or '- ' to '• ' when at start of line
  cleaned = cleaned.replace(/^\s*[*-]\s+(.+)$/gm, '• $1');
  
  // 5. Italics: *text* or _text_ to <i>text</i> without breaking already parsed bullets
  cleaned = cleaned.replace(/_([^_\n]+)_/g, '<i>$1</i>');
  cleaned = cleaned.replace(/\*([^*\n]+)\*/g, '<i>$1</i>');

  // 6. Inline code: `code` to <code>code</code>
  cleaned = cleaned.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // 7. Remove markdown blocks language names
  cleaned = cleaned.replace(/```[a-zA-Z]*\n([\s\S]*?)```/g, '$1');

  // 8. Strip any remaining/dangling Markdown characters that causes visual artifacts
  cleaned = cleaned.replace(/\*\*/g, ''); // strip unmatched dual stars
  cleaned = cleaned.replace(/__/g, '');   // strip unmatched dual underscores
  cleaned = cleaned.replace(/#{2,}/g, ''); // strip unmatched hash signs

  // 9. Remove any list asterisks/bullet artifacts left over at the beginning of bullet lines like "• *"
  cleaned = cleaned.replace(/•\s*\*/g, '•');
  cleaned = cleaned.replace(/•\s*<b>\s*\*/g, '• <b>');

  // Remove trailing or leading spaces
  cleaned = cleaned.trim();

  return cleaned;
}

/**
 * Emulates real-time streaming to Telegram using progressive message edits,
 * trying native sendMessageDraft first (Bot API 9.3) and falling back gracefully.
 */
export async function streamTextToTelegram(ctx: any, initialMessageId: number, fullText: string, prefixText: string = ""): Promise<void> {
  const words = fullText.split(/\s+/);
  
  // For extremely short messages, just update once and return
  if (words.length <= 8) {
    const finalContent = prefixText ? `${prefixText}\n\n${fullText}` : fullText;
    const closedFinalContent = closeHTMLTags(finalContent);
    
    let sentViaDraft = false;
    try {
      await ctx.telegram.callApi('sendMessageDraft', {
        chat_id: ctx.chat.id,
        draft_id: `draft_${initialMessageId}`,
        text: closedFinalContent,
        parse_mode: 'HTML'
      });
      sentViaDraft = true;
    } catch (e) {
      // Graceful fallback to editMessageText
    }

    if (!sentViaDraft) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        initialMessageId,
        undefined,
        closedFinalContent,
        { parse_mode: 'HTML' }
      ).catch(console.error);
    }
    return;
  }

  // Create progressive parts
  const parts: string[] = [];
  const wordsPerChunk = 6; // smaller chunk size for incredibly smooth streaming sensation
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    parts.push(words.slice(0, i + wordsPerChunk).join(" "));
  }

  // Guarantee the final block has the exact complete cleaned text
  if (parts.length === 0 || parts[parts.length - 1] !== fullText) {
    parts.push(fullText);
  }

  let useDraft = true; // Flag to track if native sendMessageDraft works
  const draftId = `draft_${initialMessageId}`;

  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    const body = parts[i];
    const suffix = isLast ? "" : "\n\n✍️ <i>Агент жауап жазуда...</i>";
    const content = prefixText ? `${prefixText}\n\n${body}${suffix}` : `${body}${suffix}`;
    const safeContent = closeHTMLTags(content);

    let editSuccessful = false;

    if (useDraft) {
      try {
        await ctx.telegram.callApi('sendMessageDraft', {
          chat_id: ctx.chat.id,
          draft_id: draftId,
          text: safeContent,
          parse_mode: 'HTML'
        });
        editSuccessful = true;
      } catch (err: any) {
        // Safe logger
        console.warn("⚠️ native sendMessageDraft failed, falling back to editMessageText.", err.message || err);
        useDraft = false; // Disable draft mode for subsequent iterations of this stream
      }
    }

    // Fallback path
    if (!editSuccessful) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        initialMessageId,
        undefined,
        safeContent,
        { parse_mode: 'HTML' }
      ).catch((e: any) => {
        console.error("⚠️ editMessageText failed during streaming:", e.message || e);
      });
    }

    if (!isLast) {
      await new Promise(resolve => setTimeout(resolve, 600)); // smooth stream interval
    }
  }
}

export interface AgenticImageSearchResult {
  success: boolean;
  finalAnswer: string;
  matchedCompanies: any[];
  matchedIngredients: any[];
}

/**
 * Handles the fully agentic reasoning loop for image analysis
 */
export async function executeAgenticImageSearch(ctx: any, base64Image: string, processingMsgId: number): Promise<AgenticImageSearchResult> {
  try {
    const ai = getAI();
    const matchedItems: any[] = [];

    // Construct the initial message with the base64 image and detailed instructions
    const systemInstruction = `Сен — Қазақстанның Halal Damu (ҚМДБ Халал) мекемелері мен өнімдерін және тағамдық қоспаларын (E-кодтарды) тексеретін, шешім қабылдайтын дербес «Agentic AI» көмекшісісің.

ПАЙДАЛАНУШЫ СУРЕТ ЖІБЕРДІ. СЕНІҢ ҚАДАМДАРЫҢ:
1. Суретті мұқият талдап, өнімнің атын, брендін (мысалы, "Маслёнково", "Аяла" т.б.) және құрамынан Е-кодтар мен күдікті қоспаларды анықта.
2. Суретті талдағаннан кейін тиісті құралдарды (tools/functions) шақырып базадан тексеру жүргіз:
   - Егер өнімнің немесе компанияның атын тапсаң, 'searchDatabase' құралын шақыр.
   - Егер суреттің сыртында құрамындағы Е-кодтар немесе қоспалар тізімі анықталса, 'getIngredientReport' құралын шақыр.
3. Құралды шақырған соң қайтқан нәтижеге қарап шешім қабылда (Reasoning):
   - Егер мекеме/өнім базамызда болса және сертификаты "active" болса, ХАЛАЛ екенін хабарла.
   - Егер сертификат мерзімі өткен ("expired") немесе жойылған ("revoked"/"suspended") болса, ХАРАМ немесе СЕРТИФИКАТЫ ЖОҚ қауіпті екенін ескерт.
   - Егер өнім базадан табылмаса, бірақ құрамынан ХАРАМ қоспа (мысалы, 'E120', кармин т.б.) тапсаң, немесе статусы 'mushbuh' (күдікті) қоспа тапсаң, жалпы өнім халал емес немесе күдікті болуы мүмкін екенін түсіндір.
4. Шешімді пайдаланушыға көрнекі, таза, әдемі етіп және ТЕК ҚАЗАҚ ТІЛІНДЕ жаз.
   МАҢЫЗДЫ: Телеграм терезесінде дұрыс форматталуы үшін ТЕК қана стандартты HTML тегтерін ( <b>, <i>, <code>, <pre>, <u>, <a> ) қолданып жаз. Мәтінді форматтау ережесі (ҚАТАҢ САҚТА): Жауап мәтінінде немесе Құран аудармасында сөздерді ерекшелеу үшін ешқашан қиғаш сызықтарды ( / сөз / ) немесе тік жақшаларды қолданба. Егер қандай да бір кілт сөзді немесе қосымша түсіндірмені ерекшелеу қажет болса, оны міндетті түрде тек HTML-дің қалың қаріп тегімен <b>сөз</b> деп қана жаз. Мәтін таза, әдемі және ешқандай артық символдарсыз табиғи оқылуы тиіс.
   ЕШҚАНДАЙ Markdown белгілерін (#, ##, ###, **, *, \`\`, ___ ) немесе Markdown кестелерін қолдануға БОЛМАЙДЫ!
   Мәтінді абзацтарға бөліп, көрнекі қылып жаз.
5. Пайдаланушыға сенің дербес агент екеніңді көрсетіп, «<b>Агент әрекеттері:</b>» (мысалы, Маслёнково сұранысы бойынша база тексерілді, құрамындағы қоспалар талданды) деп қысқаша қорытынды жаз.`;

    const contents: any[] = [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "image/png",
              data: base64Image
            }
          },
          {
            text: "Мына суреттегі өнімді базадан тауып, жан-жақты талдап бер."
          }
        ]
      }
    ];

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      processingMsgId,
      undefined,
      "🧠 Жасанды интеллект дербес агенттігі іске қосылды. Ойлану циклі жүріп жатыр..."
    ).catch(() => {});

    // Loop up to 3 turns to allow chain of tools execution
    let currentIteration = 0;
    const maxIterations = 3;
    let finalAnswer = "";

    while (currentIteration < maxIterations) {
      console.log(`[Agent Loop] Iteration ${currentIteration + 1} starting...`);
      
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: [searchDatabaseDeclaration, getIngredientReportDeclaration] }]
        }
      });

      // Add the model's turn to conversation history
      const modelTurn = response.candidates?.[0]?.content;
      if (modelTurn) {
        contents.push(modelTurn);
      }

      const functionCalls = response.functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        console.log(`[Agent Loop] Detected ${functionCalls.length} function calls from Gemini.`);
        
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          processingMsgId,
          undefined,
          `🛠️ Агент құралдарды шақыруда:\n${functionCalls.map(f => `👉 <code>${f.name}</code>`).join("\n")}`,
          { parse_mode: 'HTML' }
        ).catch(() => {});

        const toolParts: any[] = [];
        
        for (const call of functionCalls) {
          const resultData = await executeTool(call.name, call.args, matchedItems);
          toolParts.push({
            functionResponse: {
              name: call.name,
              response: { result: resultData }
            }
          });
        }

        // Add the tool execution response as a new history entity
        contents.push({
          role: "tool",
          parts: toolParts
        });

        currentIteration++;
      } else {
        // No more function calls, we have our final text answer
        finalAnswer = response.text || "";
        break;
      }
    }

    if (!finalAnswer) {
      finalAnswer = "Кешіріңіз, суретті талдау кезінде нақты қорытынды шығара алмадым.";
    } else {
      finalAnswer = cleanupMarkdownToHTML(finalAnswer);
    }

    // Split matched items into companies and ingredients
    const matchedCompanies = matchedItems.filter(item => item.type === "Мекеме");
    const matchedIngredients = matchedItems.filter(item => item.type === "Қоспа");

    return {
      success: true,
      finalAnswer,
      matchedCompanies,
      matchedIngredients
    };
  } catch (error) {
    console.error("❌ executeAgenticImageSearch error:", error);
    throw error;
  }
}
