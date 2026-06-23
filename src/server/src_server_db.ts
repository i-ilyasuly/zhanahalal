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

// Function to save cache to compiled chunks on Firestore for ultra-fast startup of other instances
async function saveCacheChunksToFirestore(companies: any[], ingredients: any[]) {
  try {
    console.log("🧱 Compiling and saving cache chunks to Firestore...");
    const batch = db.batch();
    
    // Chunk companies (2000 per chunk to fit comfortably within the 1MB Firestore doc limit)
    const chunkSize = 2000;
    const companyChunksCount = Math.ceil(companies.length / chunkSize);
    
    for (let i = 0; i < companyChunksCount; i++) {
      const chunk = companies.slice(i * chunkSize, (i + 1) * chunkSize);
      const docRef = db.collection("cache_chunks").doc(`companies_chunk_${i}`);
      batch.set(docRef, { chunk });
    }
    
    // Save ingredients in a single chunk
    const ingRef = db.collection("cache_chunks").doc("ingredients_chunk_0");
    batch.set(ingRef, { chunk: ingredients });
    
    // Save metadata
    const metaRef = db.collection("cache_chunks").doc("metadata");
    batch.set(metaRef, {
      companyChunksCount,
      totalCompanies: companies.length,
      totalIngredients: ingredients.length,
      updatedAt: new Date().toISOString()
    });
    
    await batch.commit();
    console.log(`🧱 Successfully saved ${companyChunksCount} company chunks and 1 ingredient chunk to Firestore cache_chunks.`);
  } catch (err: any) {
    console.error("⚠️ Failed to save cache chunks to Firestore:", err.message || err);
  }
}

// Function to load compiled cache chunks from Firestore (loads ~15,000 docs in under 1.5 seconds)
async function loadCacheChunksFromFirestore(): Promise<boolean> {
  try {
    console.log("🧱 Attempting to load cache from compiled Firestore chunks...");
    const metaDoc = await db.collection("cache_chunks").doc("metadata").get();
    if (!metaDoc.exists) {
      console.log("🧱 No cache chunks metadata found on Firestore.");
      return false;
    }
    
    const meta = metaDoc.data();
    const companyChunksCount = meta?.companyChunksCount || 0;
    if (companyChunksCount === 0) return false;
    
    const companyPromises = [];
    for (let i = 0; i < companyChunksCount; i++) {
      companyPromises.push(db.collection("cache_chunks").doc(`companies_chunk_${i}`).get());
    }
    
    const ingPromise = db.collection("cache_chunks").doc("ingredients_chunk_0").get();
    
    const [ingSnap, ...compSnaps] = await Promise.all([ingPromise, ...companyPromises]);
    
    let loadedCompanies: any[] = [];
    for (const snap of compSnaps) {
      if (snap.exists) {
        const chunk = snap.data()?.chunk;
        if (Array.isArray(chunk)) {
          loadedCompanies = loadedCompanies.concat(chunk);
        }
      }
    }
    
    let loadedIngredients: any[] = [];
    if (ingSnap.exists) {
      const chunk = ingSnap.data()?.chunk;
      if (Array.isArray(chunk)) {
        loadedIngredients = chunk;
      }
    }
    
    if (loadedCompanies.length > 0) {
      CACHE.companies = loadedCompanies;
      CACHE.ingredients = loadedIngredients;
      CACHE.loaded = true;
      console.log(`🧱 Cache loaded successfully from Firestore chunks: ${loadedCompanies.length} Companies, ${loadedIngredients.length} Ingredients.`);
      
      // Write back to local files for even faster instant start next time!
      const COMPANIES_CACHE_FILE = path.join(process.cwd(), "cache_companies.json");
      const INGREDIENTS_CACHE_FILE = path.join(process.cwd(), "cache_ingredients.json");
      try {
        fs.writeFileSync(COMPANIES_CACHE_FILE, JSON.stringify(loadedCompanies), "utf-8");
        fs.writeFileSync(INGREDIENTS_CACHE_FILE, JSON.stringify(loadedIngredients), "utf-8");
      } catch (e) {}
      
      return true;
    }
    
    return false;
  } catch (err: any) {
    console.error("⚠️ Failed to load cache from Firestore chunks:", err.message || err);
    return false;
  }
}

// Function to fetch fresh cache data from Firestore and save it to local JSON files
async function loadCacheFromFirestore() {
  const COMPANIES_CACHE_FILE = path.join(process.cwd(), "cache_companies.json");
  const INGREDIENTS_CACHE_FILE = path.join(process.cwd(), "cache_ingredients.json");

  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error("Firestore timeout (45s)")), 45000)
  );

  console.log("📥 Fetching fresh cache data from Firestore...");
  const fetchPromise = Promise.all([
    db.collection("search_companies").get(),
    db.collection("search_ingredients").get()
  ]);

  const [companiesSnapshot, ingredientsSnapshot] = await Promise.race([fetchPromise, timeoutPromise]) as any;

  const companies = companiesSnapshot.docs.map((d: any) => {
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
      _cleanTitle: cleanText(titleStr + " " + aliases + " " + tags),
      _cleanLegal: cleanText(legalStr)
    };
  });

  const ingredients = ingredientsSnapshot.docs.map((d: any) => {
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
      _cleanName: cleanText(nameKz + " " + nameRu + " " + aliases)
    };
  });

  CACHE.companies = companies;
  CACHE.ingredients = ingredients;
  CACHE.loaded = true;

  console.log(`📦 Firestore Data Received: ${companies.length} Companies, ${ingredients.length} Ingredients.`);

  // Save to local JSON files for next fast boot!
  try {
    fs.writeFileSync(COMPANIES_CACHE_FILE, JSON.stringify(companies), "utf-8");
    fs.writeFileSync(INGREDIENTS_CACHE_FILE, JSON.stringify(ingredients), "utf-8");
    console.log("💾 Cache successfully backed up to local files.");
    
    // Also save chunks to Firestore asynchronously so other instances can boot in under 1 second!
    saveCacheChunksToFirestore(companies, ingredients).catch(err => {
      console.warn("⚠️ Failed to update Firestore cache chunks in background:", err.message || err);
    });
  } catch (saveErr: any) {
    console.error("⚠️ Failed to write cache to local files:", saveErr.message || saveErr);
  }
}

// Function to populate the cache
export async function loadCache(isManualSync = false) {
  const COMPANIES_CACHE_FILE = path.join(process.cwd(), "cache_companies.json");
  const INGREDIENTS_CACHE_FILE = path.join(process.cwd(), "cache_ingredients.json");

  // 1. Try local JSON files (instant - 1ms)
  if (!isManualSync && fs.existsSync(COMPANIES_CACHE_FILE) && fs.existsSync(INGREDIENTS_CACHE_FILE)) {
    try {
      console.log("📂 Loading cache from local files (instant start)...");
      const compData = fs.readFileSync(COMPANIES_CACHE_FILE, "utf-8");
      const ingData = fs.readFileSync(INGREDIENTS_CACHE_FILE, "utf-8");
      CACHE.companies = JSON.parse(compData);
      CACHE.ingredients = JSON.parse(ingData);
      CACHE.loaded = true;
      console.log(`📦 Cache Loaded Instantly from File: ${CACHE.companies.length} Companies, ${CACHE.ingredients.length} Ingredients.`);
      
      // Trigger background refresh so it updates without blocking the startup process
      loadCacheFromFirestore().catch(err => {
        console.warn("⚠️ Background Firestore cache update failed:", err.message || err);
      });
      return;
    } catch (err: any) {
      console.warn("⚠️ Failed to load cache from local files, falling back to Firestore fetch:", err.message || err);
    }
  }

  // 2. Try compiled chunks from Firestore (very fast - ~1s)
  if (!isManualSync) {
    const loadedFromChunks = await loadCacheChunksFromFirestore();
    if (loadedFromChunks) {
      // Trigger background validation in case there are minor changes
      loadCacheFromFirestore().catch(err => {
        console.warn("⚠️ Background Firestore cache update failed:", err.message || err);
      });
      return;
    }
  }

  // 3. Fallback: Full fetch from individual Firestore docs (slow - ~20s)
  await loadCacheFromFirestore();
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
