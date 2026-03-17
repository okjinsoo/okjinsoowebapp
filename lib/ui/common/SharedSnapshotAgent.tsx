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
// [전송량 최적화] 역할별 기본 주기 정의 (Edge Requests 감축을 위해 대폭 완화)
const PULL_INTERVAL_STUDENT_MS = 300000; // 학생: 5분 (기존 1분)
const PULL_INTERVAL_TEACHER_MS = 30000;  // 선생님/관리자: 30초 (기존 10초)
const AUTH_KEY = "tutorweb_auth_session_v1";

const PENING_LOCK_TIMEOUT_MS = 5000; 

export default function SharedSnapshotAgent() {
  const hydratingRef = useRef(false);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pullIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingStateKvRef = useRef<Record<string, string>>({});
  const pendingLockedAtRef = useRef<number | null>(null); 
  const calendarSyncKeyRef = useRef("");

  useEffect(() => {
    const trySyncCalendarForCurrentLogin = () => {
      const auth = loadAuthSession();
      if (!auth?.email || !auth?.providerAccessToken) return;
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
      calendarSyncKeyRef.current = "";
      trySyncCalendarForCurrentLogin();
      void hydrate(true);
    };

    // [Edge Requests 최적화] 탭이 활성화될 때만 주기 실행 (절전 모드)
    const restartInterval = () => {
      if (pullIntervalRef.current) {
        clearInterval(pullIntervalRef.current);
        pullIntervalRef.current = null;
      }
      
      const auth = loadAuthSession();
      if (!auth) return;

      const role = window.location.pathname.startsWith("/a/") ? "a" :
                   window.location.pathname.startsWith("/t/") ? "t" :
                   window.location.pathname.startsWith("/s/") ? "s" : "guest";

      const intervalMs = role === "s" ? PULL_INTERVAL_STUDENT_MS : 
                         (role === "t" || role === "a") ? PULL_INTERVAL_TEACHER_MS : null;

      if (intervalMs) {
        console.log(`[Phase 21 실시간모드] ${role} 모드 동기화 시작 (${intervalMs / 1000}초 간격)`);
        pullIntervalRef.current = setInterval(() => {
          void hydrate(true);
        }, intervalMs);
      }
    };

    const stopInterval = () => {
      if (pullIntervalRef.current) {
        console.log("[Phase 21 절전모드] 백그라운드 전환 - 동기화 일시 정지");
        clearInterval(pullIntervalRef.current);
        pullIntervalRef.current = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void hydrate(true); 
        restartInterval();
      } else {
        stopInterval();
      }
    };

    // 초기 실행
    void hydrate(true);
    trySyncCalendarForCurrentLogin();
    restartInterval();

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
      stopInterval();
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
