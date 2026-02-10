"use client";

const memoryFallback = new Map<string, string>();

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

class BrowserStorageImpl implements Storage {
  get length(): number {
    const storage = getSessionStorage();
    if (storage) return storage.length;
    return memoryFallback.size;
  }

  clear(): void {
    const storage = getSessionStorage();
    if (storage) {
      storage.clear();
      return;
    }
    memoryFallback.clear();
  }

  getItem(key: string): string | null {
    const storage = getSessionStorage();
    if (storage) return storage.getItem(key);
    return memoryFallback.get(key) ?? null;
  }

  key(index: number): string | null {
    const storage = getSessionStorage();
    if (storage) return storage.key(index);
    const keys = Array.from(memoryFallback.keys());
    return keys[index] ?? null;
  }

  removeItem(key: string): void {
    const storage = getSessionStorage();
    if (storage) {
      storage.removeItem(key);
      return;
    }
    memoryFallback.delete(key);
  }

  setItem(key: string, value: string): void {
    const storage = getSessionStorage();
    if (storage) {
      storage.setItem(key, value);
      return;
    }
    memoryFallback.set(key, value);
  }
}

export const browserStorage: Storage = new BrowserStorageImpl();
