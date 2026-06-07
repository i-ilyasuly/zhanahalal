import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { cleanText } from "./src_server_utils.js";

function sanitizeJsonString(rawJson: string): string {
  let inString = false;
  let escape = false;
  let result = "";
  for (let i = 0; i < rawJson.length; i++) {
    const char = rawJson[i];
    if (escape) {
      if (char === '"' || char === '\\' || char === '/' || char === 'b' || char === 'f' || char === 'n' || char === 'r' || char === 't' || char === 'u') {
        result += '\\' + char;
      } else {
        result += char;
      }
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
    }
    result += char;
  }
  return result;
}

// Apply cleanup if creds look like JSON values
let parsedCreds: any = null;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  const trimmed = process.env.GOOGLE_APPLICATION_CREDENTIALS.trim();
  if (trimmed.startsWith("{")) {
    try {
      const cleaned = sanitizeJsonString(trimmed);
      parsedCreds = JSON.parse(cleaned);
      const tmpPath = path.join(process.cwd(), "service-account-env.json");
      fs.writeFileSync(tmpPath, cleaned);
      process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpPath;
      console.log("✅ Auto-fixed GOOGLE_APPLICATION_CREDENTIALS (sanitized and saved to local file).");
    } catch (e: any) {
      console.error("❌ Failed to parse/write sanitized GOOGLE_APPLICATION_CREDENTIALS:", e.message);
    }
  }
}

let parsedJsonCreds: any = null;
if (process.env.GOOGLE_CREDENTIALS_JSON) {
  const trimmed = process.env.GOOGLE_CREDENTIALS_JSON.trim();
  if (trimmed.startsWith("{")) {
    try {
      const cleaned = sanitizeJsonString(trimmed);
      parsedJsonCreds = JSON.parse(cleaned);
      console.log("✅ GOOGLE_CREDENTIALS_JSON sanitized and prepared.");
    } catch (e: any) {
      console.error("❌ Failed to parse GOOGLE_CREDENTIALS_JSON:", e.message);
    }
  }
}

// Firebase initialization
if (!admin.apps.length) {
  const certObject = parsedJsonCreds || parsedCreds;
  if (certObject) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert(certObject)
      });
      console.log("🔥 Firebase initialized explicitly using sanitized service account certificate.");
    } catch (e: any) {
      console.error("❌ Failed explicitly initializing Firebase with sanitized cert, falling back:", e.message);
      try {
        admin.initializeApp();
      } catch (inner) {}
    }
  } else {
    try {
      admin.initializeApp();
      console.log("🔥 Firebase initialized using default environment/metadata.");
    } catch (e: any) {
      console.error("❌ Default Firebase initialization failed:", e.message);
    }
  }
}

export const db = admin.firestore();

// In-memory cache to match the Python script structure
export const CACHE = {
  companies: [] as any[],
  ingredients: [] as any[],
  loaded: false
};

// Function to populate the cache
export async function loadCache(isManualSync = false) {
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error("Firestore timeout (45s)")), 45000)
  );

  try {
    if (isManualSync) console.log("🔄 Starting manual cache synchronization...");
    const fetchPromise = Promise.all([
      db.collection("search_companies").get(),
      db.collection("search_ingredients").get()
    ]);

    const [companiesSnapshot, ingredientsSnapshot] = await Promise.race([fetchPromise, timeoutPromise]) as any;

    CACHE.companies = companiesSnapshot.docs.map((d: any) => {
      const data = d.data();
      const titleStr = typeof data.title === 'string' ? data.title : "";
      const legalStr = typeof data.legal_name === 'string' ? data.legal_name : "";
      
      const aliases = Array.isArray(data.title_aliases) ? data.title_aliases.join(" ") : "";
      const tags = Array.isArray(data.tags) ? data.tags.join(" ") : "";

      return { 
        ...data,
        id: d.id, 
        _titleStr: titleStr,
        _legalStr: legalStr,
        _cleanTitle: cleanText(titleStr + " " + aliases + " " + tags), // Allow fuzzy match to find tags and aliases
        _cleanLegal: cleanText(legalStr)
      };
    });

    CACHE.ingredients = ingredientsSnapshot.docs.map((d: any) => {
      const data = d.data();
      const code = typeof data.code === 'string' ? data.code : d.id;
      const nameKz = typeof data.name_kz === 'string' ? data.name_kz : "";
      const nameRu = typeof data.name_ru === 'string' ? data.name_ru : "";
      
      const aliases = Array.isArray(data.aliases) ? data.aliases.join(" ") : "";
      
      return { 
        ...data,
        id: d.id, 
        _code: code,
        _nameKz: nameKz,
        _nameRu: nameRu,
        _cleanCode: cleanText(code),
        _cleanName: cleanText(nameKz + " " + nameRu + " " + aliases) // fuzzy math will match any of these
      };
    });
    CACHE.loaded = true;

    const method = isManualSync ? "Synchronized" : "Loaded";
    console.log(`📦 Cache ${method}: ${CACHE.companies.length} Companies, ${CACHE.ingredients.length} Ingredients.`);
  } catch (error) {
    console.error("❌ Error loading cache from Firestore:", error);
  }
}

// User tracking and usage functions
export async function addUser(chatId: number, firstName: string, username?: string) {
  try {
    const userRef = db.collection("users").doc(String(chatId));
    const doc = await userRef.get();
    if (!doc.exists) {
      await userRef.set({
        firstName,
        username: username || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        usageCount: 0
      });
      console.log(`👤 New user registered: ${firstName} (${chatId})`);
    }
  } catch (error) {
    console.error("❌ Error adding user:", error);
  }
}

export async function incrementUsage(chatId: number) {
  try {
    const userRef = db.collection("users").doc(String(chatId));
    await userRef.set({
      usageCount: admin.firestore.FieldValue.increment(1),
      lastActive: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // Also log to general stats if needed
    await db.collection("stats").doc("overall").set({
      totalRequests: admin.firestore.FieldValue.increment(1)
    }, { merge: true });
  } catch (error) {
    console.error("❌ Error incrementing usage:", error);
  }
}

export async function getChatHistory(userId: number, threadId?: number): Promise<any[]> {
  try {
    const docId = threadId ? `thread_${userId}_${threadId}` : String(userId);
    const doc = await db.collection("chat_history").doc(docId).get();
    if (doc.exists) {
      return doc.data()?.history || [];
    }
  } catch (err) {
    console.error("❌ Error getting chat history:", err);
  }
  return [];
}

export async function saveChatHistory(userId: number, role: 'user' | 'model', text: string, threadId?: number): Promise<void> {
  try {
    const history = await getChatHistory(userId, threadId);
    history.push({ role, parts: [text] });
    
    // cap history at 20 entries
    const capped = history.length > 20 ? history.slice(-20) : history;
    const docId = threadId ? `thread_${userId}_${threadId}` : String(userId);
    await db.collection("chat_history").doc(docId).set({ history: capped }, { merge: true });
  } catch (err) {
    console.error("❌ Error saving chat history:", err);
  }
}
