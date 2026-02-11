"use client";

import { useEffect, useRef } from "react";
import { AUTH_EVENT } from "@/lib/auth/supabaseAuth";
import { BROWSER_STORAGE_EVENT } from "@/lib/storage/browserStorage";
import { pullSharedSnapshotAndHydrateWithOptions, pushSharedSnapshot } from "@/lib/storage/sharedSnapshot";

const PUSH_DEBOUNCE_MS = 700;
const REMOTE_PULL_INTERVAL_MS = 2000;
const AUTH_KEY = "tutorweb_auth_session_v1";
const SHARED_KEYS = new Set([
  "tutorweb_teachers_v1",
  "tutorweb_students_v1",
  "tutorweb_sessions_v1",
  "tutorweb_consultations_v1",
]);

function shouldSyncKey(key: string): boolean {
  if (!key) return false;
  if (SHARED_KEYS.has(key)) return true;
  return key.startsWith("tutorweb_metaMap_v1:") || key.startsWith("mk3:");
}

export default function SharedSnapshotAgent() {
  const hydratingRef = useRef(false);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        void pushSharedSnapshot().catch((err) => {
          console.error("공유 스냅샷 업로드 실패(agent):", err);
        });
      }, PUSH_DEBOUNCE_MS);
    };

    const onStorageChanged: EventListener = (event) => {
      if (hydratingRef.current) return;

      const ce = event as CustomEvent<{ key?: string | null }>;
      const key = ce.detail?.key ?? "";
      if (key === AUTH_KEY) return;
      if (!shouldSyncKey(key)) return;
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
