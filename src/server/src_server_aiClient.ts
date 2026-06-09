import './src_server_crypto-patch.js';
import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

/**
 * Validates if the GCP Service Account file exists and contains a valid private key.
 */
export function validateServiceAccount(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) {
      return false;
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    const serviceAccount = JSON.parse(content);
    
    if (!serviceAccount.private_key) {
      console.warn(`[⚠️] Service Account key exists but is missing the "private_key" field.`);
      return false;
    }
    
    crypto.createPrivateKey(serviceAccount.private_key);
    return true;
  } catch (err: any) {
    console.warn(`\n[⚠️] GCP Service Account private key is technically invalid: ${err.message}`);
    return false;
  }
}

let serviceAccountPath = path.join(process.cwd(), 'gcp-service-account.json');

// Fix for ESM hoisting
if (process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.GOOGLE_APPLICATION_CREDENTIALS.trim().startsWith("{")) {
  try {
    const tmpPath = path.join(process.cwd(), "service-account-env.json");
    let credsStr = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credsStr) {
       credsStr = credsStr.replace(/\\([^ntr"\\/bf])/g, '\\\\$1');
       credsStr = credsStr.replace(/\n/g, '\\n');
    }
    try {
       let parsed = JSON.parse(credsStr);
       fs.writeFileSync(tmpPath, JSON.stringify(parsed, null, 2));
    } catch(err) {
       fs.writeFileSync(tmpPath, credsStr);
    }
    process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpPath;
    console.log("[✅] aiClient: Auto-fixed GOOGLE_APPLICATION_CREDENTIALS JSON string.");
  } catch (e) {
    console.error("Failed to auto-fix credentials in aiClient.", e);
  }
}

const autoFixedPath = path.join(process.cwd(), "service-account-env.json");
if (fs.existsSync(autoFixedPath)) {
  serviceAccountPath = autoFixedPath;
  console.log(`[✅] aiClient: Found auto-fixed service account file at ${autoFixedPath}`);
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
  serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
}

// Reconstruct if missing
if (!fs.existsSync(serviceAccountPath) && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
  try {
    let pk = process.env.FIREBASE_PRIVATE_KEY.trim();
    if (pk.includes('\\n')) pk = pk.replace(/\\n/g, '\n');
    if (!pk.includes('-----BEGIN PRIVATE KEY-----')) {
       const cleanKey = pk.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
       const chunks = cleanKey.match(/.{1,64}/g) || [];
       pk = `-----BEGIN PRIVATE KEY-----\n${chunks.join('\n')}\n-----END PRIVATE KEY-----\n`;
     }
    const content = JSON.stringify({
      type: "service_account",
      project_id: 'momyn-t1',
      private_key: pk,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
    });
    fs.writeFileSync(serviceAccountPath, content, 'utf8');
    console.log('[✅] Runtime: gcp-service-account.json ("momyn-t1") қайта жасалды.');
  } catch (e) {
    console.error("Service-account файлын құру мүмкін болмады.", e);
  }
}

// Force environment credentials
if (fs.existsSync(serviceAccountPath)) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = serviceAccountPath;
}

const saProjectId = 'momyn-t1'; 
const location = 'us-central1';

// Initialize the modern Vertex AI Client via `@google/genai`
export const aiClient = new GoogleGenAI({
  vertexai: true,
  project: saProjectId,
  location: location,
});

console.log(`[🚀] GoogleGenAI Client initialized in Vertex AI mode. Project: ${saProjectId}, Location: ${location}`);

// Normalizes input to Vertex AI format
function normalizeContents(contents: any): any[] {
  if (typeof contents === 'string') {
    return [{ role: 'user', parts: [{ text: contents }] }];
  }
  if (Array.isArray(contents)) {
    return contents.map(item => {
      if (typeof item === 'string') {
        return { role: 'user', parts: [{ text: item }] };
      }
      if (item && typeof item === 'object') {
        const role = item.role || 'user';
        let parts = item.parts;
        if (typeof parts === 'string') {
          parts = [{ text: parts }];
        } else if (Array.isArray(parts)) {
          parts = parts.map(part => {
            if (typeof part === 'string') {
              return { text: part };
            }
            return part;
          });
        }
        return { role, parts };
      }
      return item;
    });
  }
  return [];
}

// Maps legacy Gemini models to valid Vertex AI model tags
function mapModelForVertex(modelName: string): string {
  const name = String(modelName || '').toLowerCase();
  if (name.includes('embed')) {
    return 'gemini-embedding-2-preview';
  }
  if (name.includes('pro')) {
    return 'gemini-2.5-pro';
  }
  return 'gemini-2.5-flash';
}

/**
 * Compatible wrapper class for old "ai" object
 */
export const ai = {
  models: {
    generateContent: async function(args: any) {
      try {
        const vertexModel = mapModelForVertex(args.model || 'gemini-2.5-flash');
        const contents = normalizeContents(args.contents);
        
        const response = await aiClient.models.generateContent({
          model: vertexModel,
          contents: contents,
          config: args.config
        } as any);

        return {
          text: response.text || '',
          candidates: response.candidates
        };
      } catch (err: any) {
        console.error("Vertex AI generateContent error:", err);
        throw err;
      }
    },

    generateContentStream: async function(args: any) {
      try {
        const vertexModel = mapModelForVertex(args.model || 'gemini-2.5-flash');
        const contents = normalizeContents(args.contents);

        const responseStream = await aiClient.models.generateContentStream({
          model: vertexModel,
          contents: contents,
          config: args.config
        } as any);
        
        return {
          stream: responseStream,
          async *[Symbol.asyncIterator]() {
            for await (const chunk of responseStream) {
              yield {
                text: chunk.text || ''
              };
            }
          }
        };
      } catch (err: any) {
        console.error("Vertex AI generateContentStream error:", err);
        throw err;
      }
    },

    embedContent: async function(args: any) {
      const fetchFn = async () => {
        const vertexModel = mapModelForVertex(args.model || 'gemini-embedding-2');
        const res = await aiClient.models.embedContent({
          model: vertexModel,
          contents: args.contents,
          config: args.config || { outputDimensionality: 1536 }
        });
        return {
          embeddings: res.embeddings || []
        };
      };
      return retryWithBackoff(fetchFn);
    }
  }
};

/**
 * Utility function to retry API operations with exponential backoff if a rate limit/quota error is hit.
 */
export async function retryWithBackoff<T>(fn: () => Promise<T>, retries: number = 20, delay: number = 5000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    if (retries <= 0) {
      throw error;
    }
    const errMsg = typeof error?.message === 'string' ? error.message : '';
    const errStatus = typeof error?.status === 'string' ? error.status : '';
    const errString = (
      String(error) + " " +
      errMsg + " " +
      errStatus + " " +
      (error?.statusCode || "") + " " +
      (error?.status_code || "") + " " +
      JSON.stringify(error)
    ).toLowerCase();

    const isRateLimit = errStatus === 'RESOURCE_EXHAUSTED' || 
                        errString.includes('429') || 
                        error?.statusCode === 429 || 
                        error?.status === 429 ||
                        error?.error?.code === 429 ||
                        errString.includes('quota exceeded') ||
                        errString.includes('resource_exhausted') ||
                        errString.includes('quota_exceeded');
                        
    if (isRateLimit) {
      const jitter = Math.floor(Math.random() * 8000) + 1000; // 1s to 9s randomized jitter to prevent locking/thundering herd group
      const finalDelay = delay + jitter;
      console.log(`[Queue Status] API server busy. Staggering next retry attempt in ${finalDelay}ms... (${retries} attempts remaining).`);
      await new Promise(resolve => setTimeout(resolve, finalDelay));
      return retryWithBackoff(fn, retries - 1, delay * 1.5 + 2000);
    }
    throw error;
  }
}

/**
 * Official Vertex AI Document embedding helper for Company Sync process (Supports multimodal inputs)
 */
export async function getDocumentEmbedding(
  text: string,
  image?: { data: string; mimeType: string } | null
): Promise<number[]> {
  const fetchFn = async () => {
    // ЖАТТАП АЛУҒА: Қандай жағдай болса да ТЕК ҚАНА gemini-embedding-2 қолданылсын (Vertex-те ол 'gemini-embedding-2-preview' деп аталады).
    const requestedModel = 'gemini-embedding-2-preview';

    let contentParts: any;
    if (image) {
      contentParts = [
        { text: text },
        {
          inlineData: {
            mimeType: image.mimeType,
            data: image.data
          }
        }
      ];
    } else {
      contentParts = text;
    }

    const res = await aiClient.models.embedContent({
      model: requestedModel,
      contents: contentParts,
      config: {
        outputDimensionality: 1536
      }
    });

    const values = res.embeddings?.[0]?.values || [];
    if (!values || values.length === 0) {
       throw new Error("No values in embedding response");
    }

    return values;
  };

  return retryWithBackoff(fetchFn);
}

/**
 * Official Vertex AI Query embedding helper for Search/Querying process
 */
export async function getQueryEmbeddingVertex(text: string): Promise<number[] | null> {
  const fetchFn = async () => {
    // ЖАТТАП АЛУҒА: Қандай жағдай болса да ТЕК ҚАНА gemini-embedding-2 қолданылсын.
    const requestedModel = 'gemini-embedding-2-preview';
    const res = await aiClient.models.embedContent({
      model: requestedModel,
      contents: text,
      config: {
        outputDimensionality: 1536
      }
    });

    const values = res.embeddings?.[0]?.values || null;
    if (!values || values.length === 0) return null;

    return values;
  };

  try {
    return await retryWithBackoff(fetchFn);
  } catch (err: any) {
    console.error("❌ getQueryEmbeddingVertex Vertex AI error:", err?.message || err);
    return null;
  }
}

export const GEMINI_EMBEDDING_MODEL = 'gemini-embedding-2';
export const GEMINI_GENERATION_MODEL = 'gemini-2.5-flash';
export const GEMINI_INTENT_MODEL = 'gemini-2.5-flash';
