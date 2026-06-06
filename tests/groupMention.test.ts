import { describe, it, expect, vi } from 'vitest';
import { groupMentionFilterMiddleware } from '../src/server/bot/middlewares';

describe('groupMentionFilterMiddleware', () => {
    it('should let private chats pass under any condition', async () => {
        let isNextCalled = false;
        const next = async () => { isNextCalled = true; };
        
        const mockCtx = {
            chat: { type: 'private' },
            message: { text: 'Сәлем!' },
            botInfo: { id: 12345, username: 'test_bot' }
        } as any;

        await (groupMentionFilterMiddleware as any)(mockCtx, next);
        expect(isNextCalled).toBe(true);
    });

    it('should block group chats if bot is not mentioned or replied to', async () => {
        let isNextCalled = false;
        const next = async () => { isNextCalled = true; };
        
        const mockCtx = {
            chat: { type: 'supergroup' },
            message: { text: 'Кез келген хабарлама' },
            botInfo: { id: 12345, username: 'test_bot' }
        } as any;

        await (groupMentionFilterMiddleware as any)(mockCtx, next);
        expect(isNextCalled).toBe(false);
    });

    it('should allow group chats if bot is mentioned with username', async () => {
        let isNextCalled = false;
        const next = async () => { isNextCalled = true; };
        
        const mockCtx = {
            chat: { type: 'supergroup' },
            message: { text: 'Сәлеметсіз бе, @test_bot! Сүт халал ма?' },
            botInfo: { id: 12345, username: 'test_bot' }
        } as any;

        await (groupMentionFilterMiddleware as any)(mockCtx, next);
        expect(isNextCalled).toBe(true);
    });

    it('should allow group chats if bot is replied to', async () => {
        let isNextCalled = false;
        const next = async () => { isNextCalled = true; };
        
        const mockCtx = {
            chat: { type: 'group' },
            message: { 
                text: 'Иә, рахмет',
                reply_to_message: {
                    from: { id: 12345, username: 'test_bot' }
                }
            },
            botInfo: { id: 12345, username: 'test_bot' }
        } as any;

        await (groupMentionFilterMiddleware as any)(mockCtx, next);
        expect(isNextCalled).toBe(true);
    });
});
