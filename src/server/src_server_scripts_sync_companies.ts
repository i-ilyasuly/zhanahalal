import { db } from "./src_server_db.js";
import https from "https";

function fetchUrl(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function unescapeHtml(text: string): string {
  if (!text) return text;
  return text
    .replace(/&#171;/g, "«")
    .replace(/&#187;/g, "»")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export async function runSync() {
  console.log("🚀 HalalDamu API арқылы мекемелерді жаңарту басталды...");

  try {
    // 0. Алдымен ескі деректерді өшіреміз
    console.log("🧹 Ескі мекемелерді өшіру басталды...");
    const oldCompanies = await db.collection("search_companies").get();
    let deleteBatch = db.batch();
    let deleteCount = 0;
    for (const doc of oldCompanies.docs) {
      deleteBatch.delete(doc.ref);
      deleteCount++;
      if (deleteCount % 300 === 0) {
        await deleteBatch.commit();
        deleteBatch = db.batch();
      }
    }
    if (deleteCount % 300 !== 0) {
      // commit remaining deletes
      await deleteBatch.commit();
    }
    console.log(`✅ ${deleteCount} ескі мекеме өшірілді.`);

    // 1. Барлық деректерді тарту
    console.log("📥 API-дан деректер жүктелуде...");
    // Қолданылатыны: ортақ (барлық) API, себебі орыс және қазақ тіліндегі нұсқалардың барлығын іздеуге қосқан жөн
    const response = await fetchUrl("https://halaldamu.kz/wp-json/halal-bot/v1/companies?lang=kz");
    
    if (!response || !response.items || !Array.isArray(response.items)) {
      throw new Error("❌ API-дан дұрыс деректер келмеді!");
    }

    const items = response.items;
    console.log(`📦 API-дан ${items.length} мекеме табылды.`);

    // 2. Дерекқордағы ескі мекемелерді өшірмей, жаңаларын үстінен жазамыз. Немесе алдымен бәрін жаңартамыз.
    const batchSize = 300;
    let batch = db.batch();
    let count = 0;

    for (const item of items) {
      if (!item.id) continue;
      
      const newRef = db.collection("search_companies").doc(String(item.id));
      
      // Бұрынғы "search_fields" құрылымын сақтау
      const dataToSave = {
        title: unescapeHtml(item.title || ""),
        legal_name: unescapeHtml(item.legal_name || ""),
        slug: item.slug || "",
        category_type: item.category_type || "",
        certificate_status: item.certificate_status || "",
        desc: item.desc || "",
        address: unescapeHtml(item.address || ""),
        phone: item.phone || "",
        website: item.website || "",
        map_link: item.map_link || "",
        lat: item.lat || null,
        lon: item.lon || null,
        featured_image: item.featured_image || null,
        logo_image: item.logo_image || null,
        photos: item.photos || [],
        products: item.products || [],
        certificate: item.certificate || {},
        updated_at: item.updated_at || new Date().toISOString(),
        
        search_fields: {
          synonyms: [],
          ai_description: "",
          tags: [],
          embedding: []
        }
      };

      batch.set(newRef, dataToSave, { merge: true });
      count++;
      
      if (count % batchSize === 0) {
        await batch.commit();
        batch = db.batch();
        console.log(`✅ ${count} мекеме дерекқорға жазылды...`);
      }
    }
    
    if (count % batchSize !== 0) {
      await batch.commit();
    }
    
    console.log(`🎉 Жаңарту сәтті аяқталды. Барлығы: ${count} мекеме.`);
    
  } catch (error) {
    console.error("❌ Қате пайда болды:", error);
  }
}

if (process.argv[1] && process.argv[1].includes("sync_companies")) {
  runSync().then(() => process.exit(0));
}
