/**
 * server/platform/storageAdapter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Manus S3-backed storage adapter — implements IStorageAdapter.
 *
 * Delegates to the existing server/storage.ts helpers (storagePut / storageGet)
 * which are already wired to the Manus Forge storage proxy. This adapter adds
 * the interface contract so business logic can be tested with a mock adapter
 * and so the storage backend can be swapped without touching call sites.
 */
import { storagePut, storageGet } from "../storage";
import type { IStorageAdapter, StoragePutResult } from "./types";

class ManusStorageAdapter implements IStorageAdapter {
  isAvailable(): boolean {
    // storagePut/storageGet use the Forge API key internally
    return !!(process.env.BUILT_IN_FORGE_API_KEY && process.env.BUILT_IN_FORGE_API_URL);
  }

  async put(
    key: string,
    data: Buffer | Uint8Array | string,
    contentType?: string
  ): Promise<StoragePutResult> {
    return storagePut(key, data, contentType);
  }

  async get(key: string, _expiresInSeconds?: number): Promise<{ key: string; url: string }> {
    return storageGet(key);
  }
}

let _adapter: ManusStorageAdapter | null = null;

export function getStorageAdapter(): IStorageAdapter {
  if (!_adapter) _adapter = new ManusStorageAdapter();
  return _adapter;
}

export function setStorageAdapter(adapter: IStorageAdapter): void {
  _adapter = adapter as ManusStorageAdapter;
}
