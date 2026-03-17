"use client";

const memoryFallback = new Map<string, string>();
export const BROWSER_STORAGE_EVENT = "tutorweb:browserStorageChanged";

type BrowserStorageEventDetail = {
  type: "set" | "remove" | "clear";
  key?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
};

function dispatchStorageChanged(detail: BrowserStorageEventDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(BROWSER_STORAGE_EVENT, { detail }));
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

class BrowserStorageImpl implements Storage {
  private cache = new Map<string, { value: string | null; expiry: number }>();
  private readonly CACHE_TTL = 50; // 50ms 초단기 기억

  get length(): number {
    const storage = getLocalStorage();
    if (storage) return storage.length;
    return memoryFallback.size;
  }

  clear(): void {
    this.cache.clear();
    const storage = getLocalStorage();
    if (storage) {
      if (storage.length === 0) return;
      storage.clear();
      dispatchStorageChanged({ type: "clear" });
      return;
    }
    if (memoryFallback.size === 0) return;
    memoryFallback.clear();
    dispatchStorageChanged({ type: "clear" });
  }

  getItem(key: string): string | null {
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiry > now) {
      return cached.value;
    }

    const storage = getLocalStorage();
    const value = storage ? storage.getItem(key) : (memoryFallback.get(key) ?? null);
    
    this.cache.set(key, { value, expiry: now + this.CACHE_TTL });
    return value;
  }

  key(index: number): string | null {
    const storage = getLocalStorage();
    if (storage) return storage.key(index);
    const keys = Array.from(memoryFallback.keys());
    return keys[index] ?? null;
  }

  removeItem(key: string): void {
    this.cache.delete(key);
    const storage = getLocalStorage();
    if (storage) {
      const oldValue = storage.getItem(key);
      if (oldValue === null) return;
      storage.removeItem(key);
      dispatchStorageChanged({ type: "remove", key, oldValue, newValue: null });
      return;
    }
    const oldValue = memoryFallback.get(key) ?? null;
    if (oldValue === null) return;
    memoryFallback.delete(key);
    dispatchStorageChanged({ type: "remove", key, oldValue, newValue: null });
  }

  setItem(key: string, value: string): void {
    const now = Date.now();
    this.cache.set(key, { value, expiry: now + this.CACHE_TTL });

    const storage = getLocalStorage();
    if (storage) {
      const oldValue = storage.getItem(key);
      if (oldValue === value) return;
      storage.setItem(key, value);
      dispatchStorageChanged({ type: "set", key, oldValue, newValue: value });
      return;
    }
    const oldValue = memoryFallback.get(key) ?? null;
    if (oldValue === value) return;
    memoryFallback.set(key, value);
    dispatchStorageChanged({ type: "set", key, oldValue, newValue: value });
  }
}

export const browserStorage: Storage = new BrowserStorageImpl();
