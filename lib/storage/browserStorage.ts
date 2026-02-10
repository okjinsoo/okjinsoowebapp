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
    const storage = getSessionStorage();
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
