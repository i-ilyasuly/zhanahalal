import express from "express";
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

import { loadCache } from "./src/server/db.js";
import { bot } from "./src/server/bot.js";
import { searchData } from "./src/server/search.js";
import { runSync } from "./src/server/scripts/sync_companies.js";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Load Firestore Data into Memory (Non-blocking)
  loadCache().then(() => {
    console.log("📦 Cache pre-loaded.");
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

  // Start Telegram Bot Polling
  if (process.env.BOT_TOKEN) {
    console.log(`📡 Attempting to launch Telegram Bot (Token length: ${process.env.BOT_TOKEN.length})...`);
    bot.launch({ dropPendingUpdates: true }).then(() => {
      console.log("✅✅✅ Telegram Bot started via long-polling.");
      return bot.telegram.getMe();
    }).then((me) => {
      console.log(`🤖 Bot identity confirmed: @${me.username} (${me.id})`);
    }).catch(e => {
      console.error("❌❌❌ Telegram bot failed to launch:", e);
    });
  } else {
    console.error("⚠️ BOT_TOKEN not found in process.env!");
  }

  // Graceful shutdown
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  app.use(express.json());

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
  const { db } = await import("./src/server/db.js"); // lazy load since it's exported from db.js

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
      const { ai } = await import("./src/server/aiClient.js");

      const contents = history ? [...history] : [];
      if (message) {
         contents.push({ role: "user", parts: [{ text: message }] });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const responseStream = await ai.models.generateContentStream({
        model: "gemini-3.5-flash",
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

  // Telegram Webhook Proxy to Python (DEPRECATED)
  // Replaced with direct Telegraf TS integration above
  app.post("/api/webhook", (req, res) => {
    // If webhook config is desired later, mount Telegraf webhook here
    res.status(200).send("Migrated to TS long-polling.");
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
