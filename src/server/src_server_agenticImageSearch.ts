import { searchData } from "./src_server_search.js";
import { ai } from "./src_server_aiClient.js";

function getAI(): any {
  return ai;
}

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
  const tags = ['b', 'i', 'code', 'pre', 'u', 'blockquote', 'a'];
  let closed = html;
  
  // Track open tags in a LIFO stack
  const openTags: string[] = [];
  
  // Regex to find all opening or closing tags of interest
  const tagRegex = /<\/?(b|i|code|pre|u|blockquote|a)\b[^>]*>/g;
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


export interface AgenticImageSearchResult {
  success: boolean;
  finalAnswer: string;
  matchedCompanies: any[];
  matchedIngredients: any[];
}

/**
 * Handles the fully agentic reasoning loop for image analysis
 */
export async function executeAgenticImageSearch(ctx: any, base64Image: string, draftId: number): Promise<AgenticImageSearchResult> {
  try {
    const ai = getAI();
    const matchedItems: any[] = [];
    const message_thread_id = ctx.message?.message_thread_id;

    if (ctx.chat?.type === 'private') {
      await ctx.telegram.callApi('sendMessageDraft' as any, {
        chat_id: ctx.chat.id,
        message_thread_id,
        draft_id: draftId,
        text: "🔍 <i>Сурет талдануда... Және деректер базасынан ізделуде...</i>",
        parse_mode: 'HTML'
      }).catch(() => {});
    } else {
      await ctx.sendChatAction("typing").catch(() => {});
    }


    const systemInstruction = `Сен — Қазақстанның "Qazaqstan Halal Damu" (ҚМДБ Халал) ботының суреттерді талдау және өнімдерді, мекемелерді, Е-кодтарды анықтау жүйесісің.
Суретті мұқият және өте жылдам қарап шығып, одан мекеме/бренд атауын және тағамдық қоспаларды (Е-кодтарын) тауып, ТЕК келесі JSON форматында жауап бер:

{
  "detected_brand": "анықталған негізгі мекеме немесе бренд немесе өнім атауы (мысалы, 'TABA NAN', 'KFC', 'Bahandi', 'Lay's', 'Snickers')",
  "detected_ingredients": ["анықталған Е-кодтар немесе арнайы тағамдық қоспалар тізімі, мысалы: 'E471', 'E120', 'желатин'"],
  "analysis_text": "сурет бойынша қысқаша қазақша талдау (1-2 сөйлем). Тек қалың қаріп (<b>), қиғаш қаріп (<i>) немесе код тегін (<code>) қолдан, HTML тегтерін әрқашан ашып-жауып жүр. Markdown белгілерін ешқашан қолданба!"
}

Осы көрнекі JSON форматынан басқа ешбір артық мәтінді қайтарма. JSON валидті болуы тиіс.`;

    const response = await ai.models.generateContent({
      model: "gemini-flash-lite-latest",
      contents: [
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
              text: "Суреттегі өнімді, брендті немесе құрамындағы Е-кодтарды анықта."
            }
          ]
        }
      ],
      config: {
        systemInstruction,
        responseMimeType: "application/json"
      }
    });

    let raw = response.text?.trim() || "{}";
    raw = raw.replace(/```json\s*/, '').replace(/```\s*/, '').trim();
    
    let result: any = {};
    try {
      result = JSON.parse(raw);
    } catch (parseErr) {
      console.warn("⚠️ JSON parsing failed for image search, trying fallback regex", parseErr);
      const brandMatch = raw.match(/"detected_brand"\s*:\s*"([^"]+)"/);
      const brand = brandMatch ? brandMatch[1] : "";
      result = { detected_brand: brand, detected_ingredients: [], analysis_text: "" };
    }

    const brand = result.detected_brand ? result.detected_brand.trim() : "";
    const ingredients = result.detected_ingredients || [];
    let finalAnswer = result.analysis_text ? result.analysis_text.trim() : "";

    // 1. Search brand in database
    if (brand && brand.length >= 2) {
      console.log(`[Fast Image Search] Querying database for brand: "${brand}"`);
      const dbCompanies = await searchData(brand);
      for (const item of dbCompanies) {
        if (!matchedItems.some(x => x.id === item.id)) {
          matchedItems.push(item);
        }
      }
    }

    // 2. Search ingredients in database
    for (const ing of ingredients) {
      if (ing && ing.trim().length >= 2) {
        console.log(`[Fast Image Search] Querying database for ingredient: "${ing}"`);
        const dbIngredients = await searchData(ing.trim());
        const additives = dbIngredients.filter(r => r.type === "Қоспа");
        for (const item of additives) {
          if (!matchedItems.some(x => x.id === item.id)) {
            matchedItems.push(item);
          }
        }
      }
    }

    if (!finalAnswer) {
      if (matchedItems.length > 0) {
        finalAnswer = `Дерекқордан іздеу нәтижесінде сәйкес келетін өнімдер табылды.`;
      } else {
        finalAnswer = `Кешіріңіз, суреттегі өнімді немесе мекемені біздің ресми халал дерекқорымыздан таба алмадық. Құрамын тексеріп, күдікті нәрселердин жоқтығына көз жеткізіңіз.`;
      }
    }

    finalAnswer = cleanupMarkdownToHTML(finalAnswer);

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
