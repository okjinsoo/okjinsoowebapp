"use client";

import { useEffect, useRef } from "react";
import { AUTH_EVENT } from "@/lib/auth/supabaseAuth";
import { BROWSER_STORAGE_EVENT } from "@/lib/storage/browserStorage";
import { pullSharedSnapshotAndHydrate, pushSharedSnapshot } from "@/lib/storage/sharedSnapshot";

const PUSH_DEBOUNCE_MS = 700;
const AUTH_KEY = "tutorweb_auth_session_v1";

export default function SharedSnapshotAgent() {
  const hydratingRef = useRef(false);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const hydrate = async () => {
      hydratingRef.current = true;
      try {
        await pullSharedSnapshotAndHydrate();
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
      schedulePush();
    };

    const onAuthChanged = () => {
      void hydrate();
    };

    void hydrate();
    window.addEventListener(BROWSER_STORAGE_EVENT, onStorageChanged);
    window.addEventListener(AUTH_EVENT, onAuthChanged);

    return () => {
      if (pushTimerRef.current) {
        clearTimeout(pushTimerRef.current);
        pushTimerRef.current = null;
      }
      window.removeEventListener(BROWSER_STORAGE_EVENT, onStorageChanged);
      window.removeEventListener(AUTH_EVENT, onAuthChanged);
    };
  }, []);

  return null;
}
