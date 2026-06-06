import { describe, it, expect, vi } from 'vitest';

// Create the mock before any imports that use it
vi.mock('@google/genai', () => {
    return {
        GoogleGenAI: class {
            models = {
                generateContent: vi.fn().mockImplementation(async (req) => {
                    if (req.model === 'gemini-3-flash-preview' && typeof req.contents === 'string') {
                        return { text: 'Mocked Food' };
                    } else if (req.config?.responseMimeType === 'application/json') {
                        return { text: '{"product_names": ["Mock KFC", "Mock Burger"]}' };
                    }
                    return { text: 'Fallback' };
                })
            };
        }
    };
});

// Import dynamically or after mock
import { extractSearchTerm, analyzeImageBase64 } from '../src/server/ai';

describe('ai', () => {
  it('should extract search term from query', async () => {
    const result = await extractSearchTerm('I want some food');
    expect(result).toBe('Mocked Food');
  });

  it('should analyze image and return json string', async () => {
    const result = await analyzeImageBase64('base64dummy');
    expect(result).toBe('{"product_names": ["Mock KFC", "Mock Burger"]}');
  });
});
