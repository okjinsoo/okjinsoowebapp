"use client";

import { useEffect, useRef } from "react";
import { AUTH_EVENT } from "@/lib/auth/supabaseAuth";
import { BROWSER_STORAGE_EVENT } from "@/lib/storage/browserStorage";
import { pullSharedSnapshotAndHydrateWithOptions, pushSharedSnapshot } from "@/lib/storage/sharedSnapshot";

const PUSH_DEBOUNCE_MS = 700;
const REMOTE_PULL_INTERVAL_MS = 2000;
const AUTH_KEY = "tutorweb_auth_session_v1";
const CONSULTATIONS_KEY = "tutorweb_consultations_v1";
const META_MAP_PREFIX = "tutorweb_metaMap_v1:";

function isStateKvKey(key: string): boolean {
  if (!key) return false;
  if (key === CONSULTATIONS_KEY) return true;
  return key.startsWith(META_MAP_PREFIX);
}

export default function SharedSnapshotAgent() {
  const hydratingRef = useRef(false);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStateKvRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const hydrate = async (forceRemote = false) => {
      if (hydratingRef.current) return;
      hydratingRef.current = true;
      try {
        await pullSharedSnapshotAndHydrateWithOptions({ forceRemote });
      } catch (err) {
        console.error("공유 스냅샷 하이드레이션 실패(agent):", err);
      } finally {
        hydratingRef.current = false;
      }
    };

    const schedulePush = () => {
      if (pushTimerRef.current) {
        clearTimeout(pushTimerRef.current);
      }
      pushTimerRef.current = setTimeout(() => {
        const pending = { ...pendingStateKvRef.current };
        pendingStateKvRef.current = {};
        if (Object.keys(pending).length === 0) return;

        void pushSharedSnapshot({ stateKv: pending }).catch((err) => {
          pendingStateKvRef.current = {
            ...pending,
            ...pendingStateKvRef.current,
          };
          console.error("공유 스냅샷 업로드 실패(agent):", err);
        });
      }, PUSH_DEBOUNCE_MS);
    };

    const onStorageChanged: EventListener = (event) => {
      if (hydratingRef.current) return;

      const ce = event as CustomEvent<{ key?: string | null; newValue?: string | null }>;
      const key = ce.detail?.key ?? "";
      if (key === AUTH_KEY) return;
      if (!isStateKvKey(key)) return;

      const newValue = ce.detail?.newValue;
      if (typeof newValue !== "string") return;
      pendingStateKvRef.current[key] = newValue;
      schedulePush();
    };

    const onAuthChanged = () => {
      void hydrate(true);
    };

    const onFocus = () => {
      void hydrate(true);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void hydrate(true);
      }
    };

    void hydrate();
    const intervalId = window.setInterval(() => {
      void hydrate(true);
    }, REMOTE_PULL_INTERVAL_MS);
    window.addEventListener(BROWSER_STORAGE_EVENT, onStorageChanged);
    window.addEventListener(AUTH_EVENT, onAuthChanged);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(intervalId);
      if (pushTimerRef.current) {
        clearTimeout(pushTimerRef.current);
        pushTimerRef.current = null;
      }
      window.removeEventListener(BROWSER_STORAGE_EVENT, onStorageChanged);
      window.removeEventListener(AUTH_EVENT, onAuthChanged);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
