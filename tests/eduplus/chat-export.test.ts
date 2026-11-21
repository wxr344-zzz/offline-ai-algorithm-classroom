import { describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { BrowserRuntimeStore } from '@openmaic/storage';
import { readPersistedChatSessions, saveChatSessions } from '@/lib/utils/chat-storage';
import type { ChatSession } from '@/lib/types/chat';

if (!('IDBKeyRange' in globalThis))
  Object.defineProperty(globalThis, 'IDBKeyRange', { value: IDBKeyRange, configurable: true });

describe('read-only classroom dialogue export', () => {
  it('reads the persisted visible snapshot without cleanup, writes or another learner partition', async () => {
    const store = new BrowserRuntimeStore({ indexedDB: new IDBFactory() });
    const chat: ChatSession = {
      id: 'chat-one',
      type: 'qa',
      title: '问答',
      status: 'completed',
      messages: [
        {
          id: 'message-one',
          role: 'user',
          parts: [{ type: 'text', text: '为什么空列表返回零？' }],
        },
      ],
      config: { agentIds: ['default-1'], defaultAgentId: 'default-1' },
      toolCalls: [],
      pendingToolCalls: [],
      createdAt: 1000,
      updatedAt: 2000,
      sceneId: 'concept',
    };
    await saveChatSessions('stage-export', [chat], { store, learnerKey: 'learner-one' });
    const create = vi.spyOn(store, 'createSession');
    const append = vi.spyOn(store, 'appendRecord');
    const remove = vi.spyOn(store, 'deleteSession');
    const loaded = await readPersistedChatSessions(store, 'stage-export', 'learner-one');
    expect(loaded).toHaveLength(1);
    expect(loaded[0].messages).toEqual(chat.messages);
    expect(loaded[0].sceneId).toBe('concept');
    expect(await readPersistedChatSessions(store, 'stage-export', 'learner-two')).toEqual([]);
    expect(create).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
