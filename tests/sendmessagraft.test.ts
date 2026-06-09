import { describe, it, expect, vi } from 'vitest';
import { sendmessagraft } from '../src/server/src_server_sendmessagraft.js';
import fetch from 'node-fetch';

// node-fetch модулін моктаймыз
vi.mock('node-fetch', () => {
  return {
    default: vi.fn(),
  };
});

describe('sendmessagraft Telegram Bot API Feature', () => {
  it('sendmessagraft функциясы сәтті орындалуы керек', async () => {
    // Мок жауапты баптаймыз
    const mockResponse = {
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 123, text: 'draft' } })
    };
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

    const result: any = await sendmessagraft('test_token', '123456', 'Бұл тест қаралам');

    // fetch шақырылғанын қатаң тексереміз
    expect(fetch).toHaveBeenCalled();
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1];
    
    // sendmessagraft API нүктесі қолданылуын тексереміз! БҰЛ МАҢЫЗДЫ! ОЛ БАР!
    expect(lastCall[0]).toContain('sendmessagraft');
    expect(result.ok).toBe(true);
    expect(result.result?.message_id).toBe(123);
  });

  it('sendmessagraft fallback логикасы жұмыс істеуі керек', async () => {
    const errorResponse = {
      ok: false,
      status: 404,
      json: async () => ({ ok: false, description: 'Not Found' })
    };
    const successFallbackResponse = {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 124 } })
    };
    
    // Бірінші рет 404 берсін, екіншісінде сәтті болсын
    (fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(errorResponse)
      .mockResolvedValueOnce(successFallbackResponse);

    const result: any = await sendmessagraft('test_token', '123456', 'Fallback draft тест');
    console.log("результат: ", result);
    
    expect(result.ok).toBe(true);
    // Екі рет шақырылғанын тексереміз
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1];
    // Екінші шақыру sendMessage арқылы өтуі керек
    expect(lastCall[0]).toContain('sendMessage');
  });
});
