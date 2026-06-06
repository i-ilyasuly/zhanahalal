import { describe, it, expect, vi } from 'vitest';

// Create the mock before any imports that use it
vi.mock('@google/genai', () => {
    const mockModelFn = vi.fn().mockImplementation(async (req) => {
        if (req.model === 'gemini-flash-lite-latest' && typeof req.contents === 'string') {
            return { text: 'Mocked Food' };
        } else if (req.config?.responseMimeType === 'application/json') {
            return { text: '{"product_names": ["Mock KFC", "Mock Burger"]}' };
        }
        return { text: 'Fallback' };
    });
    return {
        GoogleGenAI: class {
            models = {
                generateContent: mockModelFn,
                generateContentStream: vi.fn().mockImplementation(async () => {
                    return {
                        async *[Symbol.asyncIterator]() {
                            yield { text: 'Fallback Stream' };
                        }
                    };
                }),
                embedContent: vi.fn().mockImplementation(async () => {
                    return { embedding: { values: [0.1, 0.2] } };
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
