import admin from "firebase-admin";
import fs from "fs";
import path from "path";

// 1. Initialize Firebase
if (process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.GOOGLE_APPLICATION_CREDENTIALS.trim().startsWith("{")) {
  try {
    const tmpPath = path.join(process.cwd(), "service-account-env.json");
    fs.writeFileSync(tmpPath, process.env.GOOGLE_APPLICATION_CREDENTIALS);
    process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpPath;
    console.log("✅ Auto-fixed GOOGLE_APPLICATION_CREDENTIALS.");
  } catch(e) {
    console.error("Failed to write temp credentials file.");
  }
}

if (!admin.apps.length) {
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    try {
      const serviceAccount = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log("🔥 Firebase initialized using GOOGLE_CREDENTIALS_JSON.");
    } catch (e) {
      console.error("❌ Failed to parse GOOGLE_CREDENTIALS_JSON.");
      process.exit(1);
    }
  } else {
    admin.initializeApp();
    console.log("🔥 Firebase initialized using default behavior.");
  }
}

const db = admin.firestore();

function normalizeStatus(oldStatus: any): "halal" | "haram" | "mushbuh" {
  const statusStr = String(oldStatus?.id || oldStatus?.name || oldStatus || "").toLowerCase();
  if (statusStr.includes("halal") || statusStr.includes("халал") || statusStr.includes("рұқсат")) return "halal";
  if (statusStr.includes("haram") || statusStr.includes("харам") || statusStr.includes("тыйым")) return "haram";
  return "mushbuh"; // Defaults to mushbuh if not strictly halal/haram
}

function extractKzRu(obj: any): { kz: string, ru: string } {
  if (!obj) return { kz: "", ru: "" };
  if (typeof obj === 'string') return { kz: obj, ru: obj };
  return {
    kz: obj.kz || obj.ru || "",
    ru: obj.ru || obj.kz || ""
  };
}

async function migrate() {
  console.log("Starting ingredients migration...");
  
  const oldSnapshot = await db.collection("ingredients").get();
  console.log(`Found ${oldSnapshot.size} old ingredients.`);

  const newCollection = db.collection("search_ingredients");
  let migratedCount = 0;

  for (const doc of oldSnapshot.docs) {
    const data = doc.data();
    const id = doc.id; // often the E code
    
    // Extract strings
    const titleKzRu = extractKzRu(data.title || id);
    const nameKzRu = extractKzRu(data.name);
    const descKzRu = extractKzRu(data.desc);
    
    // Normalize code (e.g. E120)
    let code = id;
    if (/^\d{3,4}[a-z]?$/i.test(code)) {
      code = "E" + code.toUpperCase(); // 120 -> E120
    } else {
      code = code.toUpperCase(); // E120 -> E120
    }

    // Determine status
    const status = normalizeStatus(data.status);

    // Build base object
    const newIngredient = {
      code: code,
      name_kz: nameKzRu.kz || titleKzRu.kz,
      name_ru: nameKzRu.ru || titleKzRu.ru,
      aliases: [], // Empty for now, can be populated via CMS
      status: status,
      source_type: "Unknown", // Synthetic, Animal, Plant, Microbial, Unknown
      status_reason: "",
      danger_level: "Medium", // Default, adjust via CMS later
      is_allergen: false,
      category: typeof data.category === 'string' ? data.category : "Қоспа",
      description_clean: descKzRu.kz || descKzRu.ru,
      is_active: data.is_active !== false // Default true unless explicitly false
    };

    await newCollection.doc(doc.id).set(newIngredient);
    migratedCount++;
    console.log(`Migrated ${id} -> ${code}`);
  }

  console.log(`Migration complete! Successfully migrated ${migratedCount} ingredients to 'search_ingredients'.`);
}

migrate().catch(console.error);
