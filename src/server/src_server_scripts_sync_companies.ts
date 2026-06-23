import { db } from "./src_server_db.js";
import admin from "firebase-admin";
import https from "https";
import { ai } from "./src_server_aiClient.js";
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

// Сәйкес сурет және ембеддинг функциялары өшірілді

export async function runSync(force: boolean = false, onProgress?: (msg: string) => void) {
  writeSyncLog(`🚀 HalalDamu API арқылы мекемелерді жаңарту басталды... (force: ${force})`, onProgress);

  try {
    // 0. Firestore-дан бұрыннан бар мекемелерді алып, updated_at мәндерінің Map-ін құрамыз
    console.log("📥 Firestore-дағы бар мекемелерді индекстеу...");
    const snapshot = await db.collection("search_companies").get();
    const existingMap = new Map<string, { updated_at: string }>();
    for (const doc of snapshot.docs) {
      const data = doc.data();
      existingMap.set(doc.id, {
        updated_at: data.updated_at || ""
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

      if (!force && existing && existing.updated_at === apiUpdatedAt) {
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
          tags: []
        }
      };

      const docRef = db.collection("search_companies").doc(idStr);
      await docRef.set(dataToSave, { merge: true });
    };

    // Топтар бойынша (chunks of 100) параллельді өңдеу (LLM квота шектеуі жоқ болғандықтан өте жылдам)
    const chunkSize = 100;
    for (let i = 0; i < itemsToProcess.length; i += chunkSize) {
      const chunk = itemsToProcess.slice(i, i + chunkSize);
      processedCount += chunk.length;

      writeSyncLog(`⏳ [Sync Batch] Топ ${Math.floor(i / chunkSize) + 1} / ${Math.ceil(itemsToProcess.length / chunkSize)} (${chunk.length} / ${itemsToProcess.length} мекеме)...`, onProgress);

      await Promise.all(chunk.map(async (item) => {
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
          throw err;
        }
      }));

      writeSyncLog(`[Sync] Processed batch of ${chunk.length} companies. Current total: ${processedCount}`, onProgress);
    }

    // 6. Firestore-да бар, бірақ API-де жоқ мекемелерді өшіру
    let deleteCount = 0;
    const batchSize = 100;
    let deleteBatch = db.batch();

    for (const existingId of existingMap.keys()) {
      if (!apiIds.has(existingId)) {
        // Тек цифрлардан тұратын ID-лерді ғана өшіреміз (яғни WordPress-тен келгендерді).
        // Қолдан немесе тест үшін жасалған (әріптері бар) ID-лерді ешқашан өшірмейміз!
        if (!/^\d+$/.test(existingId)) {
          console.log(`⚠️ [PRESERVE] Қолмен жасалған немесе тесттік мекеме сақталды (ID: ${existingId})`);
          continue;
        }

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
    console.log(`🔄 Жаңартылғаны: ${updateCount}`);
    console.log(`🗑️ Өшірілгені: ${deleteCount}`);

    if (onProgress) {
      onProgress(`\n🎉 Синхрондау сәтті аяқталды!\n` +
        `⏭️ Өткізілгені (өзгеріссіз): ${skipCount}\n` +
        `➕ Жаңадан қосылғаны: ${addCount}\n` +
        `🔄 Жаңартылғаны: ${updateCount}\n` +
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

