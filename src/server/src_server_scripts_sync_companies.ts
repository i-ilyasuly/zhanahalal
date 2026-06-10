import { db } from "./src_server_db.js";
import admin from "firebase-admin";
import https from "https";
import { ai, GEMINI_EMBEDDING_MODEL, getDocumentEmbedding } from "./src_server_aiClient.js";
import { FieldValue } from "firebase-admin/firestore";
import fs from "fs";
import path from "path";

export let lastSyncError: string | null = null;

function writeSyncLog(text: string, onProgress?: (msg: string) => void) {
  const line = `[${new Date().toISOString()}] ${text}\n`;
  console.log(text);
  if (onProgress) {
    onProgress(text + "\n");
  }
  try {
    const logPath = path.join(process.cwd(), "bot_logs.txt");
    fs.appendFileSync(logPath, line);
  } catch (err) {
    // Ignore log write errors
  }
}

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

function decodeHTML(text: string): string {
  if (!text) return "";
  return text
    .replace(/&#038;/g, "&")
    .replace(/&#171;/g, "«")
    .replace(/&#187;/g, "»")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function getCategoryTranslation(categoryType: string): string {
  const cat = String(categoryType || "").toLowerCase().trim();
  switch (cat) {
    case "restaurant":
    case "cafe":
    case "ресторан":
    case "кафе":
      return "Мейрамхана немесе кафе / Ресторан или кафе";
    case "fast-food":
    case "fast_food":
    case "фаст-фуд":
      return "Тез дайындалатын тағамдар / Фаст-фуд";
    case "production_facility":
    case "production":
    case "facility":
    case "производство":
    case "өндіріс":
      return "Өндіріс орны / Производственное предприятие";
    case "slaughterhouse":
    case "сойыс":
    case "убойный пункт":
      return "Қасапхана немесе сою пункті / Убойный пункт";
    case "market":
    case "магазин":
    case "дүкен":
      return "Дүкен немесе сауда маркеті / Магазин или супермаркет";
    case "pastry":
    case "кондитер":
      return "Кондитерлік өнімдер орны / Кондитерский цех";
    default:
      return categoryType || "Анықталмаған санат / Неопределенная категория";
  }
}

async function getCompanyImageBase64(imageUrl: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) {
      return null;
    }
    const buf = await res.arrayBuffer();
    const base64Bytes = Buffer.from(buf).toString("base64");
    
    let mimeType = res.headers.get("content-type") || "image/jpeg";
    mimeType = mimeType.split(";")[0].trim();
    if (!mimeType.startsWith("image/")) {
      mimeType = "image/jpeg";
    }
    return { data: base64Bytes, mimeType };
  } catch (err: any) {
    console.warn(`⚠️ [Image Fetch] Error fetching image ${imageUrl}:`, err.message || err);
    return null;
  }
}

async function getEmbedding(text: string, image?: { data: string; mimeType: string } | null): Promise<number[]> {
  try {
    const values = await getDocumentEmbedding(text, image);
    if (values && values.length > 0) {
      if (values.length !== 1536) {
        throw new Error(`Expected embedding size 1536, got ${values.length}`);
      }
      return values;
    }
    throw new Error("No values in embedding response");
  } catch (err) {
    console.error(`⚠️ Embedding алу барысында қате шықты:`, err);
    throw err; // Тікелей лақтырамыз (rethrow)
  }
}

export async function runSync(force: boolean = false, onProgress?: (msg: string) => void) {
  writeSyncLog(`🚀 HalalDamu API арқылы мекемелерді жаңарту және ақылды векторлау басталды... (force: ${force})`, onProgress);

  try {
    // 0. WIPE EXISTING EMBEDDINGS IF force = true
    if (force) {
      writeSyncLog("⚠️ [Sync] force=true: Wipe existing embeddings from Firestore started...", onProgress);
      
      const querySnapshot = await db.collection("search_companies").get();
      const allDocs = querySnapshot.docs;
      
      writeSyncLog(`🗑️ [Sync] Clearing embeddings for ${allDocs.length} companies...`, onProgress);

      let batch = db.batch();
      let opCount = 0;
      let totalWiped = 0;

      for (const doc of allDocs) {
        const docRef = db.collection("search_companies").doc(doc.id);
        batch.update(docRef, {
          "search_fields.embedding": FieldValue.delete()
        });
        opCount++;
        totalWiped++;

        if (opCount === 500) {
          await batch.commit();
          batch = db.batch();
          opCount = 0;
          writeSyncLog(`🧹 [Sync] Committed bulk wipe batch of ${totalWiped} documents.`, onProgress);
        }
      }

      if (opCount > 0) {
        await batch.commit();
        writeSyncLog(`🧹 [Sync] Committed final bulk wipe batch of ${totalWiped} documents.`, onProgress);
      }

      writeSyncLog("✅ [Sync] All existing embeddings wiped successfully from Firestore!", onProgress);
    }
    // 0. Firestore-дан бұрыннан бар мекемелерді алып, updated_at мәндерінің Map-ін құрамыз
    console.log("📥 Firestore-дағы бар мекемелерді индекстеу...");
    const snapshot = await db.collection("search_companies").get();
    const existingMap = new Map<string, { updated_at: string, hasEmbedding: boolean }>();
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const embValue = data.search_fields?.embedding;
      let hasEmb = false;
      if (embValue) {
        if (Array.isArray(embValue)) {
          hasEmb = embValue.length > 0;
        } else if (typeof embValue === "object") {
          hasEmb = true;
        }
      }
      existingMap.set(doc.id, {
        updated_at: data.updated_at || "",
        hasEmbedding: hasEmb
      });
    }
    console.log(`📌 Firestore-да қазір ${existingMap.size} мекеме бар.`);

    // 1. Барлық деректерді API-дан тарту
    console.log("📥 API-дан деректер жүктелуде...");
    const response = await fetchUrl("https://halaldamu.kz/wp-json/halal-bot/v1/companies?lang=kz");
    
    if (!response || !response.items || !Array.isArray(response.items)) {
      throw new Error("❌ API-дан дұрыс деректер келмеді!");
    }

    const items = response.items;
    console.log(`📦 API-дан ${items.length} мекеме табылды.`);
    if (onProgress) {
      onProgress(`📦 API-дан ${items.length} мекеме табылды.\n`);
    }

    const apiIds = new Set<string>();
    let skipCount = 0;
    let updateCount = 0;
    let addCount = 0;
    let processedCount = 0;

    // Сүзгілеу: өңделуі тиіс мекемелер мен аттап өтілетін мекемелер тізімі
    const itemsToProcess: any[] = [];
    for (const item of items) {
      if (!item.id) continue;
      const idStr = String(item.id);
      apiIds.add(idStr);

      const apiUpdatedAt = item.updated_at || "";
      const existing = existingMap.get(idStr);

      if (!force && existing && existing.updated_at === apiUpdatedAt && existing.hasEmbedding) {
        skipCount++;
        continue;
      }
      itemsToProcess.push(item);
    }

    console.log(`📊 Синхрондалатын мекемелер саны: ${itemsToProcess.length} (Барлығы: ${items.length}, Аттап өтілгендері: ${skipCount})`);
    if (onProgress) {
      onProgress(`📊 Синхрондалатын мекемелер саны: ${itemsToProcess.length} (Барлығы: ${items.length}, Аттап өтілгендері: ${skipCount})\n`);
    }

    // Әр мекеме үшін өңдеу функциясы
    const processItem = async (item: any) => {
      const idStr = String(item.id);
      const titleCleaned = decodeHTML(item.title || "");
      const existing = existingMap.get(idStr);
      const isNew = !existing;
      const apiUpdatedAt = item.updated_at || "";

      // HTML кодтардан тазарту
      const legalNameCleaned = decodeHTML(item.legal_name || "");
      const addressCleaned = decodeHTML(item.address || "");

      // 2GIS координаттарын шығару
      let latVal: number | null = null;
      let lonVal: number | null = null;

      if (item.lat && item.lon) {
        latVal = parseFloat(item.lat);
        lonVal = parseFloat(item.lon);
      } else if (item.map_link) {
        const match2gis = item.map_link.match(/[?&]m=([0-9.]+)(?:%2C|,)([0-9.]+)/i);
        if (match2gis) {
          lonVal = parseFloat(match2gis[1]);
          latVal = parseFloat(match2gis[2]);
        }
      }

      let coordinatesGeoPoint: admin.firestore.GeoPoint | null = null;
      if (latVal !== null && lonVal !== null && !isNaN(latVal) && !isNaN(lonVal)) {
        try {
          coordinatesGeoPoint = new admin.firestore.GeoPoint(latVal, lonVal);
        } catch (e) {
          // GeoPoint қатесін жасыру
        }
      }

      // Rich Description мәтіні
      let productsText = "";
      if (Array.isArray(item.products) && item.products.length > 0) {
        const productNames = item.products.map((p: any) => {
          if (typeof p === "string") return p;
          if (p && typeof p === "object") {
            return p.title || p.name || JSON.stringify(p);
          }
          return "";
        }).filter((x: any) => !!x);
        
        if (productNames.length > 0) {
          productsText = productNames.join(", ");
        }
      }

      let richDescriptionText = `Мекеме атауы: ${titleCleaned} / Название: ${titleCleaned}.\n`;
      richDescriptionText += `Заңды тұлға: ${legalNameCleaned}.\n`;
      richDescriptionText += `Санаты: ${getCategoryTranslation(item.category_type)}.\n`;
      richDescriptionText += `Орналасқан жері: ${addressCleaned}.\n`;
      if (productsText) {
        richDescriptionText += `Өнімдері / Продукция: ${productsText}`;
      }
      richDescriptionText = richDescriptionText.trim();

      // Сурет сілтемесін алу
      let imageUrl: string | null = null;
      if (item.featured_image && typeof item.featured_image === "object" && item.featured_image.full) {
        imageUrl = item.featured_image.full;
      } else if (item.logo_image && typeof item.logo_image === "object" && item.logo_image.full) {
        imageUrl = item.logo_image.full;
      } else if (typeof item.featured_image === "string") {
        imageUrl = item.featured_image;
      } else if (typeof item.logo_image === "string") {
        imageUrl = item.logo_image;
      }

      let imageData: { data: string; mimeType: string } | null = null;
      if (imageUrl) {
        imageData = await getCompanyImageBase64(imageUrl);
      }

      // Ембеддинг жасау
      let embeddingVector: number[] = [];
      try {
        embeddingVector = await getEmbedding(richDescriptionText, imageData);
      } catch (err) {
        console.error(`❌ Векторлау мүмкін болмады (ID ${idStr}):`, err);
        throw err;
      }

      if (!embeddingVector || embeddingVector.length === 0) {
        throw new Error(`Embedding vector empty for ID ${idStr}`);
      }

      const vectorValueObj = FieldValue.vector(embeddingVector);

      const dataToSave = {
        title: titleCleaned,
        legal_name: legalNameCleaned,
        slug: item.slug || "",
        category_type: item.category_type || "",
        certificate_status: item.certificate_status || "",
        desc: item.desc || "",
        address: addressCleaned,
        phone: item.phone || "",
        website: item.website || "",
        map_link: item.map_link || "",
        lat: latVal,
        lon: lonVal,
        coordinates: coordinatesGeoPoint,
        featured_image: item.featured_image || null,
        logo_image: item.logo_image || null,
        photos: item.photos || [],
        products: item.products || [],
        certificate: item.certificate || {},
        updated_at: apiUpdatedAt || new Date().toISOString(),
        
        search_fields: {
          synonyms: [],
          ai_description: richDescriptionText,
          tags: [],
          embedding: vectorValueObj
        }
      };

      const docRef = db.collection("search_companies").doc(idStr);
      await docRef.set(dataToSave, { merge: true });
    };

    // Топтар бойынша (chunks of 15) параллельді өңдеу
    const chunkSize = 15;
    for (let i = 0; i < itemsToProcess.length; i += chunkSize) {
      const chunk = itemsToProcess.slice(i, i + chunkSize);
      processedCount += chunk.length;

      writeSyncLog(`⏳ [Sync Batch] Top ${Math.floor(i / chunkSize) + 1} / ${Math.ceil(itemsToProcess.length / chunkSize)} (${chunk.length} / ${itemsToProcess.length} мекеме)...`, onProgress);

      await Promise.all(chunk.map(async (item, idx) => {
        // Stagger each item in the batch by idx * 850ms to flatten the spike of requests hitting Vertex AI
        await new Promise(resolve => setTimeout(resolve, idx * 850));
        try {
          const idStr = String(item.id);
          const existing = existingMap.get(idStr);
          await processItem(item);
          if (!existing) {
            addCount++;
          } else {
            updateCount++;
          }
        } catch (err: any) {
          writeSyncLog(`❌ [Sync Error] Сәйкес мекенді өңдеу сәтсіз аяқталды (ID: ${item.id}): ${err.stack || err.message || err}`, onProgress);
          throw err; // Квота немесе Vertex AI қатесін сыртқа лақтырамыз (rethrow)
        }
      }));

      writeSyncLog(`[Sync] Embedded batch of 15 companies. Current total: ${processedCount}`, onProgress);

      // Квотаны қорғау үшін 1 секунд кідіріс
      if (i + chunkSize < itemsToProcess.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // 6. Firestore-да бар, бірақ API-де жоқ мекемелерді өшіру
    let deleteCount = 0;
    const batchSize = 100;
    let deleteBatch = db.batch();

    for (const existingId of existingMap.keys()) {
      if (!apiIds.has(existingId)) {
        console.log(`🗑️ [DELETE] API-де табылған жоқ, өшірілуде: ID ${existingId}`);
        const docRef = db.collection("search_companies").doc(existingId);
        deleteBatch.delete(docRef);
        deleteCount++;

        if (deleteCount % batchSize === 0) {
          await deleteBatch.commit();
          deleteBatch = db.batch();
        }
      }
    }

    if (deleteCount % batchSize !== 0) {
      await deleteBatch.commit();
    }

    console.log(`\n🎉 Синхрондау сәтті аяқталды!`);
    console.log(`⏭️ Өткізілгені (өзгеріссіз): ${skipCount}`);
    console.log(`➕ Жаңадан қосылғаны: ${addCount}`);
    console.log(`🔄 Жаңартылғаны (векторланды): ${updateCount}`);
    console.log(`🗑️ Өшірілгені: ${deleteCount}`);

    if (onProgress) {
      onProgress(`\n🎉 Синхрондау сәтті аяқталды!\n` +
        `⏭️ Өткізілгені (өзгеріссіз): ${skipCount}\n` +
        `➕ Жаңадан қосылғаны: ${addCount}\n` +
        `🔄 Жаңартылғаны (векторланды): ${updateCount}\n` +
        `🗑️ Өшірілгені: ${deleteCount}\n`
      );
    }

  } catch (error: any) {
    console.error("❌ Синхрондау кезінде қате пайда болды:", error);
    lastSyncError = error.message || String(error);
    throw error;
  }
}

if (process.argv[1] && process.argv[1].includes("sync_companies")) {
  runSync().then(() => process.exit(0));
}

