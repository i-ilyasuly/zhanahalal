import { describe, it, expect, vi } from 'vitest';
import { streamTextToTelegram } from '../src/server/src_server_bot_streamUtils.js';

describe('streamTextToTelegram', () => {
    it('should split text into chunks and call sendMessageDraft in order', async () => {
        const text = "Бұл сынақ мәтіні. Ол бірнеше сөзден тұрады.";
        const calls: any[] = [];
        
        const mockCtx = {
            message: { message_thread_id: 123 },
            chat: { id: 456 },
            telegram: {
                callApi: vi.fn().mockImplementation(async (method, payload) => {
                    if (method === 'sendMessageDraft') {
                         calls.push(payload.text);
                    }
                    return Promise.resolve();
                })
            }
        };

        const startTime = Date.now();
        await streamTextToTelegram(mockCtx, 999, text);
        const endTime = Date.now();

        // 8 words total, chunk size is 6.
        // Chunk 1: "Бұл сынақ мәтіні. Ол бірнеше сөзден ▌"
        // Chunk 2: "Бұл сынақ мәтіні. Ол бірнеше сөзден тұрады."
        
        expect(mockCtx.telegram.callApi).toHaveBeenCalled();
        expect(calls.length).toBeGreaterThan(0);
        
        // Final call to clear should be ""
        expect(calls[calls.length - 1]).toBe("");
        
        // Second to last should be the actual string
        expect(calls[calls.length - 2]).toBe(text);
        
        // Should have delayed between chunks
        expect(endTime - startTime).toBeGreaterThan(100);
    });

    it('should handle small snippets instantly', async () => {
        const text = "Қысқа мәтін.";
        const calls: any[] = [];
        
        const mockCtx = {
            message: { message_thread_id: 123 },
            chat: { id: 456 },
            telegram: {
                callApi: vi.fn().mockImplementation(async (method, payload) => {
                    if (method === 'sendMessageDraft') {
                         calls.push(payload.text);
                    }
                    return Promise.resolve();
                })
            }
        };

        await streamTextToTelegram(mockCtx, 100, text);
        
        // One for the text, one for the empty draft clear
        expect(calls.length).toBe(2);
        expect(calls[0]).toBe("Қысқа мәтін.");
        expect(calls[1]).toBe("");
    });

    it('should skip drafts and call sendChatAction with typing for groups', async () => {
        const text = "Бұл топтағы ұзақ мәтінді жауап.";
        const draftCalls: any[] = [];
        let typingCalled = false;
        
        const mockCtx = {
            message: { message_thread_id: 123 },
            chat: { id: 456, type: 'group' },
            sendChatAction: vi.fn().mockImplementation(async (action) => {
                if (action === 'typing') {
                    typingCalled = true;
                }
                return Promise.resolve();
            }),
            telegram: {
                callApi: vi.fn().mockImplementation(async (method, payload) => {
                    if (method === 'sendMessageDraft') {
                         draftCalls.push(payload.text);
                    }
                    return Promise.resolve();
                })
            }
        };

        await streamTextToTelegram(mockCtx, 101, text);
        
        // sendMessageDraft should NOT be called at all
        expect(draftCalls.length).toBe(0);
        // sendChatAction typing must be called once
        expect(typingCalled).toBe(true);
    });
});
