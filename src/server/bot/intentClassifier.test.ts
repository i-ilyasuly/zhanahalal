import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shouldClassify, classifyQuery } from './intentClassifier.js';
import { ai } from '../aiClient.js';

// Mock the AI Client
vi.mock('../aiClient.js', () => {
  return {
    ai: {
      models: {
        generateContent: vi.fn(),
      },
    },
  };
});

describe('intentClassifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('shouldClassify', () => {
    it('returns false for empty string', () => {
      expect(shouldClassify('')).toBe(false);
      expect(shouldClassify('   ')).toBe(false);
    });

    it('returns true for any non-empty string', () => {
      expect(shouldClassify('сәлем')).toBe(true);
      expect(shouldClassify('KFC')).toBe(true);
      expect(shouldClassify('Snickers халал ма?')).toBe(true);
    });
  });

  describe('classifyQuery', () => {
    it('handles "chat" intent successfully', async () => {
      (ai.models.generateContent as any).mockResolvedValue({
        text: JSON.stringify({
          action: 'chat',
          query: '',
          reply: 'Сәлеметсіз бе! Мен Halal Damu ботымын. Қандай өнімді тексергіңіз келеді?'
        })
      });

      const result = await classifyQuery('ассалаумағалейкум');
      expect(result.action).toBe('chat');
      expect(result.reply).toContain('Сәлеметсіз бе');
      expect(ai.models.generateContent).toHaveBeenCalledTimes(1);
    });

    it('handles "search" intent successfully, stripping redundant words', async () => {
      (ai.models.generateContent as any).mockResolvedValue({
        text: JSON.stringify({
          action: 'search',
          query: 'Snickers',
          reply: ''
        })
      });

      const result = await classifyQuery('Snickers халал ма?');
      expect(result.action).toBe('search');
      expect(result.query).toBe('Snickers');
      expect(result.reply).toBe('');
      expect(ai.models.generateContent).toHaveBeenCalledTimes(1);
    });

    it('forces "chat" intent for lowercase basic greetings even if AI incorrectly outputs "search"', async () => {
      // Simulate AI making a mistake
      (ai.models.generateContent as any).mockResolvedValue({
        text: JSON.stringify({
          action: 'search',
          query: 'рақмет',
          reply: ''
        })
      });

      const result = await classifyQuery('рақмет');
      // Should be forcefully overridden by the fallback heuristic
      expect(result.action).toBe('chat');
      expect(result.query).toBe('');
      expect(result.reply).toContain('Оқасы жоқ');
    });

    it('handles Symbat mode properly by modifying the system prompt', async () => {
      (ai.models.generateContent as any).mockResolvedValue({
        text: JSON.stringify({
          action: 'chat',
          query: '',
          reply: 'Сәлем Ботам!'
        })
      });

      const result = await classifyQuery('сәлем', true);
      expect(result.action).toBe('chat');
      expect(result.reply).toBe('Сәлем Ботам!');
      
      const callArgs = (ai.models.generateContent as any).mock.calls[0][0];
      const sysPrompt = callArgs.config.systemInstruction;
      expect(sysPrompt).toContain('СЫМБАТПЕН СӨЙЛЕСУ');
      expect(sysPrompt).toContain('махаббатпен');
    });

    it('falls back to "search" safely when an exception is thrown', async () => {
      (ai.models.generateContent as any).mockRejectedValue(new Error('Network Error'));

      const result = await classifyQuery('Кез келген сұрақ');
      expect(result.action).toBe('search');
      expect(result.query).toBe('Кез келген сұрақ');
      expect(result.reply).toBe('');
    });
  });
});
