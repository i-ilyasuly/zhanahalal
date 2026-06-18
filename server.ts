import express from "express";
import admin from "firebase-admin";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import dotenv from "dotenv";
import fs from "fs";
import cron from "node-cron";

dotenv.config({ override: true });

// FIX for User pasting JSON string into GOOGLE_APPLICATION_CREDENTIALS
if (process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.GOOGLE_APPLICATION_CREDENTIALS.trim().startsWith("{")) {
  const tmpPath = path.join(process.cwd(), "service-account-env.json");
  fs.writeFileSync(tmpPath, process.env.GOOGLE_APPLICATION_CREDENTIALS);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpPath;
  console.log("✅ Auto-fixed GOOGLE_APPLICATION_CREDENTIALS (saved raw JSON to a local temp file).");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { loadCache } from "./src/server/src_server_db.js";
import { bot } from "./src/server/src_server_bot.js";
import { searchData } from "./src/server/src_server_search.js";
import { runSync, lastSyncError } from "./src/server/src_server_scripts_sync_companies.js";

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Load Firestore Data into Memory (Non-blocking)
  loadCache().then(async () => {
    console.log("📦 Cache pre-loaded.");
    if (process.env.NODE_ENV !== "production") {
      console.log("🔌 [Startup Sync] Даму кезеңі: бірінші жүктелудегі автоматты синхрондау іске қосылды...");
      try {
        await runSync();
        await loadCache(true);
        console.log("✅ [Startup Sync] Бірінші синхрондау сәтті аяқталды!");
      } catch (e) {
        console.error("❌ [Startup Sync] Бірінші синхрондау барысында қате шықты:", e);
      }
    }
  }).catch(e => console.error("Initial cache load failed:", e));

  // Schedule automatic sync at 03:00 AM (Astana/Almaty time) every day
  cron.schedule("0 3 * * *", async () => {
    console.log("⏰ Күнделікті 03:00 жаңартуы басталды (cron job)...");
    try {
      await runSync();
      await loadCache(true);
      console.log("✅ Күнделікті жаңарту сәтті аяқталды!");
    } catch (e) {
      console.error("❌ Күнделікті жаңарту барысында қате шықты:", e);
    }
  }, {
    timezone: "Asia/Almaty"
  });

  // Start Telegram Bot via Long Polling
  if (process.env.BOT_TOKEN) {
    const masked = process.env.BOT_TOKEN.substring(0, 6) + "..." + process.env.BOT_TOKEN.slice(-4);
    const writeLog = (txt: string) => {
      try {
        fs.appendFileSync(path.join(process.cwd(), "bot_logs.txt"), `[${new Date().toISOString()}] [Startup] ${txt}\n`);
      } catch (e) {}
    };
    writeLog(`Bot launch attempt. Token: ${masked}`);
    console.log(`📡 [Telegram Polling] Ботты іске қосу әрекеті (Masked: ${masked})...`);
    
    // Explicitly delete any existing webhook to clear conflicting configuration
    bot.telegram.deleteWebhook({ drop_pending_updates: true })
      .then(async () => {
        writeLog("Old webhook deleted. Fetching Bot details before launch...");
        console.log("🧹 Кез келген ескі Webhook сәтті өшірілді.");
        const me = await bot.telegram.getMe();
        writeLog(`Bot identity verified: @${me.username} (${me.id})`);
        console.log(`🤖 Бот сәйкестігі расталды: @${me.username} (${me.id})`);

        // Launch without holding startup promise
        bot.launch({ dropPendingUpdates: true }).then(() => {
          writeLog("Bot polling stopped dynamically.");
        }).catch(err => {
          writeLog(`BOT RUNTIME EXCEPTION: ${err.message || String(err)}`);
          console.error("❌ bot.launch runtime error:", err);
        });

        writeLog("Telegram Bot successfully launched in background long-polling mode.");
        console.log("✅✅✅ Telegram Бот long-polling режимінде сәтті қосылды.");
      })
      .catch(e => {
        writeLog(`BOT LAUNCH ERROR: ${e.message}\n${e.stack}`);
        if (e.message && e.message.includes("409")) {
          writeLog("CONFLICT 409: Another bot instance is currently running with this token!");
          console.warn("\n⚠️⚠️⚠️ [TELEGRAM CONFLICT 409] ⚠️⚠️⚠️\nБотты іске қосу барысында 409 (Conflict) қатесі шықты. Бұл дегеніміз - дәл осы Token-мен басқа серверде боттың тағы бір нұсқасы қатар жұмыс істеп тұр.\nTelegram бір уақытта тек БІР ҒАНА бот нұсқасына хабарлама алуға (polling) рұқсат береді.\n");
        } else {
          console.error("❌❌❌ Telegram bot failed to launch:", e);
        }
      });
  } else {
    try {
      fs.appendFileSync(path.join(process.cwd(), "bot_logs.txt"), `[${new Date().toISOString()}] [Startup] ERROR: BOT_TOKEN not found!\n`);
    } catch (e) {}
    console.error("⚠️ BOT_TOKEN not found in process.env!");
  }

  // Graceful shutdown
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  app.use(express.json());

  // Zero-dependency Ping (Saves developer from waiting for Firebase/loading)
  app.get("/api/ping", (req, res) => {
    res.json({ message: "pong", status: "online" });
  });

  // API Status Endpoint
  app.get("/api/status", (req, res) => {
    res.json({ status: "active", bot: "running", version: "2.0.0" });
  });

  app.get("/api/search", async (req, res) => {
    const q = req.query.q as string;
    if (!q) return res.json([]);
    try {
      const results = await searchData(q);
      res.json(results);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Search failed" });
    }
  });

  app.post("/api/sync", async (req, res) => {
    try {
      await loadCache(true);
      res.json({ success: true, message: "Cache synchronized successfully" });
    } catch (e) {
      console.error("Sync failed:", e);
      res.status(500).json({ success: false, error: "Synchronization failed" });
    }
  });

  // --- Admin API Routes ---
  const { db } = await import("./src/server/src_server_db.js"); // lazy load since it's exported from db.js

  app.get("/api/admin/sync-now", async (req, res) => {
    const force = req.query.force === "true";
    console.log(`📥 [Manual Trigger] Қолмен синхрондау сұранысы қабылданды (GET /api/admin/sync-now, force: ${force})...`);
    
    // Жауапты бірден қайтарамыз (фонда жалғасады)
    res.json({
      success: true,
      message: "🚀 Синхрондау фонда (background) басталды! Процесс сервер логтарында жалғасады және контейнер сөніп қалмауы үшін кепілденген фондық жұмыс атқарылады."
    });
    
    // Фонда кедергісіз (background) орындаймыз
    runSync(force, (msg: string) => {
      // Консольге жазамыз, өйткені res жіберіліп қойды
    }).then(async () => {
      console.log("\n🔄 [Sync Background] Кеш оқылуда...");
      await loadCache(true);
      console.log("✅ [Sync Background] Деректер мен кеш сәтті жаңартылды!");
    }).catch((e: any) => {
      console.error("❌ [Sync Background Error] Қолмен синхрондау сәтсіз аяқталды:", e);
    });
  });

  app.get("/api/admin/sync-status", async (req, res) => {
    console.log("📊 [Admin Sync Status] Статусты есептеу басталды...");
    try {
      // 1. Жалпы саны
      // select() арқылы тек қажетті өрістерді оқып, жылдамдық пен жадты үнемдейміз
      const snapshot = await db.collection("search_companies")
        .select("updated_at", "title")
        .get();

      const total_companies = snapshot.size;

      // 2. Деректер құрылымын тексеру (Сынақ үлгісі ретінде алғашқы 5 мекеме)
      const sample_companies = snapshot.docs.slice(0, 5).map(doc => {
        const data = doc.data();
        const raw_updated_at = data.updated_at;
        let updated_at_type: string = typeof raw_updated_at;
        if (raw_updated_at instanceof Date) {
          updated_at_type = "Date object (Date)";
        } else if (raw_updated_at && typeof raw_updated_at === "object") {
          updated_at_type = `Object (${raw_updated_at.constructor.name})`;
        }

        return {
          id: doc.id,
          title: data.title || "",
          updated_at: raw_updated_at,
          updated_at_type: updated_at_type
        };
      });

      res.status(200).json({
        success: true,
        status: "Diagnostic finished",
        total_companies,
        last_sync_error: lastSyncError || null,
        sample_companies
      });
    } catch (e: any) {
      console.error("❌ [Admin Sync Status Error]:", e);
      res.status(500).json({
        success: false,
        error: e.message || String(e),
        last_sync_error: lastSyncError || null,
        stack: e.stack || ""
      });
    }
  });

  app.get("/api/admin/real-search", async (req, res) => {
    const q = req.query.q as string;
    console.log(`🔍 [Admin Real Search] q: "${q}" ізделуде...`);
    try {
      const results = await searchData(q || "кофе");
      res.status(200).json({ success: true, count: results.length, results });
    } catch (e: any) {
      console.error("❌ [Admin Real Search Error]:", e);
      res.status(500).json({ success: false, error: e.message || String(e), stack: e.stack || "" });
    }
  });

  app.get("/api/admin/test-search", async (req, res) => {
    const q = req.query.q as string;
    if (q) {
      console.log(`🔍 [Admin Test Search] Running vector search directly for query: "${q}"...`);
      try {
        const results = await searchData(q);
        return res.status(200).json({ success: true, count: results.length, query: q, results });
      } catch (e: any) {
        console.error("❌ [Admin Test Search Direct Error]:", e);
        return res.status(500).json({ success: false, error: e.message || String(e), stack: e.stack || "" });
      }
    }

    console.log("🔍 [Admin Test Search] Диагностикалық тексеру басталды...");
    const report: any = {
      status: "Diagnostic finished",
      step1_firestore: "NOT RUN",
      step2_gemini: "NOT RUN",
      step3_vector_query: "NOT RUN"
    };

    // 1-ҚАДАМ: FIRESTORE БАЗАСЫМЕН БАЙЛАНЫС (Test Connection)
    try {
      const snap = await db.collection("search_companies").limit(1).get();
      if (!snap.empty) {
        report.step1_firestore = `OK (Found doc ID: ${snap.docs[0].id})`;
      } else {
        report.step1_firestore = "OK (Collection is empty, connection works)";
      }
    } catch (e: any) {
      report.step1_firestore = `FAILED: ${e.message || String(e)}`;
    }

    // 2-ҚАДАМ: GEMINI МӘТІН ГЕНЕРАЦИЯСЫН СЫНАУ (Test Gemini Generation)
    try {
      const { ai, GEMINI_GENERATION_MODEL } = await import("./src/server/src_server_aiClient.js");
      const genResponse = await ai.models.generateContent({
        model: GEMINI_GENERATION_MODEL,
        contents: "Сәлем"
      });
      if (genResponse && genResponse.text) {
        report.step2_gemini = `OK (Response: ${genResponse.text.trim().substring(0, 30)}...)`;
      } else {
        report.step2_gemini = "FAILED: Client returned empty response";
      }
    } catch (e: any) {
      report.step2_gemini = `FAILED: ${e.message || String(e)}`;
    }

    // 3-ҚАДАМ: ВЕКТОРЛЫҚ СҰРАНЫСТЫ СЫНАУ (Ембеддинг жойылды)
    report.step3_vector_query = "SKIPPED: Векторлық іздеу толықтай жойылды (Дерекқор жеңіл және жылдам мәтіндік іздеуге өткізілді)";

    res.status(200).json(report);
  });

  app.get("/api/admin/:collection", async (req, res) => {
    const { collection } = req.params;
    if (collection !== "search_companies" && collection !== "search_ingredients") {
      return res.status(400).json({ error: "Invalid collection" });
    }
    try {
      const snap = await db.collection(collection).get();
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      res.json(docs);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Fetch failed" });
    }
  });

  app.get("/api/admin/:collection/:id", async (req, res) => {
    const { collection, id } = req.params;
    if (collection !== "search_companies" && collection !== "search_ingredients") {
      return res.status(400).json({ error: "Invalid collection" });
    }
    try {
      const doc = await db.collection(collection).doc(id).get();
      if (!doc.exists) return res.status(404).json({ error: "Not found" });
      res.json({ id: doc.id, ...doc.data() });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Fetch failed" });
    }
  });

  app.put("/api/admin/:collection/:id", async (req, res) => {
    const { collection, id } = req.params;
    if (collection !== "search_companies" && collection !== "search_ingredients") {
      return res.status(400).json({ error: "Invalid collection" });
    }
    try {
      const data = { ...req.body };
      delete data.id; // avoid saving id inside document
      await db.collection(collection).doc(id).update(data);
      // Automatically refresh cache on edit
      loadCache(false).catch(console.error);
      res.json({ success: true });
    } catch (e: any) {
      console.error(e);
      // Wait, if document doesn't exist, update fails. Use set with merge if needed.
      if (e.code === 5) { // NOT_FOUND
         await db.collection(collection).doc(id).set(req.body);
         loadCache(false).catch(console.error);
         return res.json({ success: true });
      }
      res.status(500).json({ error: "Update failed" });
    }
  });

  app.post("/api/admin/:collection", async (req, res) => {
    const { collection } = req.params;
    if (collection !== "search_companies" && collection !== "search_ingredients") {
      return res.status(400).json({ error: "Invalid collection" });
    }
    try {
      const docRef = await db.collection(collection).add(req.body);
      loadCache(false).catch(console.error);
      res.json({ success: true, id: docRef.id });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Create failed" });
    }
  });

  app.delete("/api/admin/:collection/:id", async (req, res) => {
    const { collection, id } = req.params;
    if (collection !== "search_companies" && collection !== "search_ingredients") {
      return res.status(400).json({ error: "Invalid collection" });
    }
    try {
      await db.collection(collection).doc(id).delete();
      loadCache(false).catch(console.error);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Delete failed" });
    }
  });

  // --- New ChatGPT-like API Endpoint ---
  app.post("/api/chat", async (req, res) => {
    try {
      const { message, history } = req.body;
      const { ai } = await import("./src/server/src_server_aiClient.js");

      const contents = history ? [...history] : [];
      if (message) {
         contents.push({ role: "user", parts: [{ text: message }] });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const responseStream = await ai.models.generateContentStream({
        model: "gemini-flash-lite-latest",
        contents,
      });

      for await (const chunk of responseStream) {
        if (chunk.text) {
          res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
        }
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (e: any) {
      console.error("Chat API failed:", e);
      // In case headers are already sent, stream an error
      if (!res.headersSent) {
        res.status(500).json({ error: "Chat failed", details: e.message });
      } else {
        res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
        res.end();
      }
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

startServer();
