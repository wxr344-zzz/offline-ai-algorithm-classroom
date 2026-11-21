import { describe, expect, it } from 'vitest';
import {
  BrowserAssetStore,
  BrowserDocumentStore,
  BrowserKVStore,
  BrowserRuntimeStore,
  DocumentVersionError,
  RuntimeAppendConflictError,
} from '@openmaic/storage/browser';
import {
  DocumentVersionError as OriginalDocumentVersionError,
  RuntimeAppendConflictError as OriginalAppendConflictError,
} from '@openmaic/storage';

describe('browser-only storage entrypoint', () => {
  it('preserves shared error identity across old and browser entrypoints', () => {
    expect(DocumentVersionError).toBe(OriginalDocumentVersionError);
    expect(RuntimeAppendConflictError).toBe(OriginalAppendConflictError);
    expect(
      [BrowserAssetStore, BrowserDocumentStore, BrowserRuntimeStore].every(
        (value) => typeof value === 'function',
      ),
    ).toBe(true);
  });
  it('keeps device and account values independent through the browser KV backend', async () => {
    const values = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => {
        values.delete(key);
      },
      setItem: (key, value) => {
        values.set(key, value);
      },
    };
    const store = new BrowserKVStore({ storage, namespace: 'browser-entry-test' });
    await store.set('draft', 'local-value', 'device');
    await store.set('draft', 'account-value', 'account');
    expect(await store.get('draft', 'device')).toBe('local-value');
    expect(await store.get('draft', 'account')).toBe('account-value');
  });
});
