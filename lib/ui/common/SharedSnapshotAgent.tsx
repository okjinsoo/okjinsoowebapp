"use client";

import { useEffect, useRef } from "react";
import { AUTH_EVENT, loadAuthSession } from "@/lib/auth/supabaseAuth";
import { BROWSER_STORAGE_EVENT } from "@/lib/storage/browserStorage";
import { pullSharedSnapshotAndHydrateWithOptions, pushSharedSnapshot } from "@/lib/storage/sharedSnapshot";
import { syncGoogleCalendarForExistingSessions } from "@/lib/storage/sessions";
import {
  isSessionProgressStateKey,
  isSharedStateKvKey,
  SHARED_LECTURE_TREE_KEY,
} from "@/lib/storage/sharedStateKeys";

const PUSH_DEBOUNCE_MS = 700;
const PUSH_RETRY_MS = 1500;
const REMOTE_PULL_INTERVAL_MS = 5000; // 30초에서 5초로 단축하여 실시간성 강화항목 수정 Corporate
const AUTH_KEY = "tutorweb_auth_session_v1";

export default function SharedSnapshotAgent() {
  const hydratingRef = useRef(false);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStateKvRef = useRef<Record<string, string>>({});
  const calendarSyncKeyRef = useRef("");

  useEffect(() => {
    const trySyncCalendarForCurrentLogin = () => {
      const auth = loadAuthSession();
      if (!auth?.email) return;
      if (!auth?.providerAccessToken) return;
      const syncKey = `${auth.email.toLowerCase()}::${auth.userId ?? ""}`;
      if (calendarSyncKeyRef.current === syncKey) return;
      calendarSyncKeyRef.current = syncKey;
      syncGoogleCalendarForExistingSessions();
    };

    const hydrate = async (forceRemote = false) => {
      if (hydratingRef.current) return;
      if (Object.keys(pendingStateKvRef.current).length > 0) {
        // 로컬 변경이 아직 서버로 올라가는 중이면, 더 오래된 원격값으로 덮어쓰지 않음
        return;
      }
      hydratingRef.current = true;
      try {
        await pullSharedSnapshotAndHydrateWithOptions({ forceRemote });
      } catch (err) {
        console.error("공유 스냅샷 하이드레이션 실패(agent):", err);
      } finally {
        hydratingRef.current = false;
      }
    };

    const flushPending = () => {
      const pending = { ...pendingStateKvRef.current };
      pendingStateKvRef.current = {};
      if (Object.keys(pending).length === 0) return;

      void pushSharedSnapshot({ stateKv: pending })
        .then((result) => {
          if (result.stateKvSynced) return;
          pendingStateKvRef.current = {
            ...pending,
            ...pendingStateKvRef.current,
          };
          schedulePush(PUSH_RETRY_MS);
        })
        .catch((err) => {
          pendingStateKvRef.current = {
            ...pending,
            ...pendingStateKvRef.current,
          };
          console.error("공유 스냅샷 업로드 실패(agent):", err);
          schedulePush(PUSH_RETRY_MS);
        });
    };

    const schedulePush = (delayMs = PUSH_DEBOUNCE_MS) => {
      if (pushTimerRef.current) {
        clearTimeout(pushTimerRef.current);
      }
      pushTimerRef.current = setTimeout(() => {
        flushPending();
      }, delayMs);
    };

    const onStorageChanged: EventListener = (event) => {
      if (hydratingRef.current) return;

      const ce = event as CustomEvent<{ key?: string | null; newValue?: string | null }>;
      const key = ce.detail?.key ?? "";
      if (key === AUTH_KEY) return;
      if (!isSharedStateKvKey(key)) return;

      const newValue = ce.detail?.newValue;
      if (typeof newValue !== "string") return;
      pendingStateKvRef.current[key] = newValue;
      // 강의 트리/회차 강의 배치/진도는 화면 체감이 커서 지연 없이 업로드 -> 배치 전송으로 전환 (서버 부하 경감)
      if (key === SHARED_LECTURE_TREE_KEY || isSessionProgressStateKey(key)) {
        schedulePush();
        return;
      }
      schedulePush();
    };

    const onAuthChanged = () => {
      calendarSyncKeyRef.current = "";
      trySyncCalendarForCurrentLogin();
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

    void hydrate().finally(() => {
      trySyncCalendarForCurrentLogin();
    });
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
