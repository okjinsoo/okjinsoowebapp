"use client";

import { useEffect, useRef } from "react";
import { AUTH_EVENT, loadAuthSession } from "@/lib/auth/supabaseAuth";
import { BROWSER_STORAGE_EVENT } from "@/lib/storage/browserStorage";
import {
  pullSharedSnapshotAndHydrateWithOptions,
  pushSharedSnapshot,
  STUDENTS_KEY,
  TEACHERS_KEY,
  SESSIONS_KEY,
  dispatchLocalSnapshotUpdated
} from "@/lib/storage/sharedSnapshot";
import { syncGoogleCalendarForExistingSessions } from "@/lib/storage/sessions";
import {
  isSharedStateKvKey,
  SHARED_CONSULTATIONS_KEY,
  SHARED_LECTURE_TREE_KEY,
  SHARED_META_MAP_PREFIX,
} from "@/lib/storage/sharedStateKeys";
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";

const PUSH_DEBOUNCE_MS = 700;
const PUSH_RETRY_MS = 1500;
const AUTH_KEY = "tutorweb_auth_session_v1";

const PENING_LOCK_TIMEOUT_MS = 5000; 

export default function SharedSnapshotAgent() {
  const hydratingRef = useRef(false);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStateKvRef = useRef<Record<string, string>>({});
  const pendingLockedAtRef = useRef<number | null>(null); 
  const calendarSyncKeyRef = useRef("");

  useEffect(() => {
    const trySyncCalendarForCurrentLogin = () => {
      const auth = loadAuthSession();
      if (!auth?.email || !auth?.providerAccessToken) {
        // 로그아웃(또는 토큰 소실) 시 다음 로그인에서 다시 1회 동기화되도록 키를 초기화
        calendarSyncKeyRef.current = "";
        return;
      }
      const syncKey = `${auth.email.toLowerCase()}::${auth.userId ?? ""}`;
      if (calendarSyncKeyRef.current === syncKey) return;
      calendarSyncKeyRef.current = syncKey;
      syncGoogleCalendarForExistingSessions();
    };

    const hydrate = async (forceRemote = false) => {
      if (hydratingRef.current) return;
      if (Object.keys(pendingStateKvRef.current).length > 0) {
        const lockedAt = pendingLockedAtRef.current;
        if (lockedAt !== null && Date.now() - lockedAt > PENING_LOCK_TIMEOUT_MS) {
          pendingLockedAtRef.current = null;
          schedulePush(PUSH_RETRY_MS);
        } else {
          return;
        }
      }
      hydratingRef.current = true;
      try {
        await pullSharedSnapshotAndHydrateWithOptions({ forceRemote });
      } catch (err) {
        console.error("공유 스냅샷 하이드레이션 실패:", err);
      } finally {
        hydratingRef.current = false;
      }
    };

    const flushPending = () => {
      const pending = { ...pendingStateKvRef.current };
      pendingStateKvRef.current = {};
      pendingLockedAtRef.current = null;
      if (Object.keys(pending).length === 0) return;

      void pushSharedSnapshot({ stateKv: pending })
        .then((result) => {
          if (result.stateKvSynced) return;
          if (Object.keys(pendingStateKvRef.current).length === 0) {
            pendingLockedAtRef.current = Date.now();
          }
          pendingStateKvRef.current = { ...pending, ...pendingStateKvRef.current };
          schedulePush(PUSH_RETRY_MS);
        })
        .catch(() => {
          if (Object.keys(pendingStateKvRef.current).length === 0) {
            pendingLockedAtRef.current = Date.now();
          }
          pendingStateKvRef.current = { ...pending, ...pendingStateKvRef.current };
          schedulePush(PUSH_RETRY_MS);
        });
    };

    const schedulePush = (delayMs = PUSH_DEBOUNCE_MS) => {
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
      pushTimerRef.current = setTimeout(() => flushPending(), delayMs);
    };

    const onStorageChanged: EventListener = (event) => {
      if (hydratingRef.current) return;
      const ce = event as CustomEvent<{ key?: string | null; newValue?: string | null }>;
      const key = ce.detail?.key ?? "";
      if (key === AUTH_KEY || !isSharedStateKvKey(key)) return;
      const newValue = ce.detail?.newValue;
      if (typeof newValue !== "string") return;
      if (Object.keys(pendingStateKvRef.current).length === 0) {
        pendingLockedAtRef.current = Date.now();
      }
      pendingStateKvRef.current[key] = newValue;
      schedulePush();
    };

    const onAuthChanged = () => {
      trySyncCalendarForCurrentLogin();
      void hydrate(true);
    };

    // [Vercel 비용 최적화] 정기 폴링(Interval) 대신 탭 활성화 시 전용 동기화(Focus Sync)로 전환
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        console.log("[Phase 21 On-Demand] 탭 활성화 감지 - 서버 데이터 갱신 시작");
        void hydrate(true); 
      }
    };

    // 초기 실행 시 서버 데이터 동기화
    void hydrate(true);
    trySyncCalendarForCurrentLogin();

    const onPageHide = () => {
      if (pushTimerRef.current) {
        clearTimeout(pushTimerRef.current);
        pushTimerRef.current = null;
      }
      flushPending();
    };

    const onNativeStorageChanged = (e: StorageEvent) => {
      if (e.storageArea !== window.localStorage) return;
      const key = e.key;
      if (!key) return;

      // 다른 탭에서 핵심 데이터(학생/선생님/세션)를 변경했을 경우 현재 탭의 UI도 갱신
      if (key === STUDENTS_KEY || key === TEACHERS_KEY || key === SESSIONS_KEY) {
        dispatchLocalSnapshotUpdated({ includeSessions: key === SESSIONS_KEY });
      } else if (isSharedStateKvKey(key)) {
        // 기타 공유 상태 변경 시 관련 이벤트 발생
        if (key === SHARED_CONSULTATIONS_KEY) window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.consultationsUpdated));
        if (key === SHARED_LECTURE_TREE_KEY) window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.lectureTreeUpdated));
        if (key.startsWith(SHARED_META_MAP_PREFIX)) window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.metaMapUpdated));
      }
    };

    window.addEventListener(BROWSER_STORAGE_EVENT, onStorageChanged);
    window.addEventListener("storage", onNativeStorageChanged);
    window.addEventListener(AUTH_EVENT, onAuthChanged);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (pushTimerRef.current) {
        clearTimeout(pushTimerRef.current);
        pushTimerRef.current = null;
      }
      window.removeEventListener(BROWSER_STORAGE_EVENT, onStorageChanged);
      window.removeEventListener("storage", onNativeStorageChanged);
      window.removeEventListener(AUTH_EVENT, onAuthChanged);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return null;
}
