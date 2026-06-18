import { db } from "./src_server_db.js";

async function runMigration() {
  console.log("🚀 Миграция басталды...");
  
  const companiesSnap = await db.collection("companies").get();
  console.log(`📦 Деректер базасында ${companiesSnap.docs.length} мекеме табылды.`);
  
  const ingredientsSnap = await db.collection("ingredients").get();
  console.log(`🫙 Деректер базасында ${ingredientsSnap.docs.length} қоспа табылды.`);
  
  const batchSize = 200;
  
  // Migrate companies
  console.log("🏢 Мекемелерді жаңа 'search_companies' API-ына көшіру басталды...");
  let batch = db.batch();
  let count = 0;
  for (const doc of companiesSnap.docs) {
    const data = doc.data();
    const newRef = db.collection("search_companies").doc(doc.id);
    batch.set(newRef, {
      ...data,
      search_fields: {
        synonyms: [],
        ai_description: "",
        tags: []
      }
    });
    count++;
    
    if (count % batchSize === 0) {
      await batch.commit();
      batch = db.batch();
      console.log(`✅ ${count} мекеме көшірілді...`);
    }
  }
  if (count % batchSize !== 0) await batch.commit();
  console.log(`🎉 Мекемелерді көшіру сәтті аяқталды. Толық: ${count}`);
  
  // Migrate ingredients
  console.log("🧪 Қоспаларды жаңа 'search_ingredients' API-ына көшіру басталды...");
  batch = db.batch();
  count = 0;
  for (const doc of ingredientsSnap.docs) {
    const data = doc.data();
    const newRef = db.collection("search_ingredients").doc(doc.id);
    batch.set(newRef, {
      ...data,
      search_fields: {
        synonyms: [],
        ai_description: "",
        tags: []
      }
    });
    count++;
    if (count % batchSize === 0) {
      await batch.commit();
      batch = db.batch();
      console.log(`✅ ${count} қоспа көшірілді...`);
    }
  }
  if (count % batchSize !== 0) await batch.commit();
  console.log(`🎉 Қоспаларды көшіру сәтті аяқталды. Толық: ${count}`);
  
  console.log("🏆 Барлық база көшірілді! 1-Кезең аяқталды.");
}

runMigration().catch(console.error).finally(() => process.exit(0));
