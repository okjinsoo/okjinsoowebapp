"use client";

import { useEffect, useRef } from "react";
import { AUTH_EVENT, isProviderTokenExpired, loadAuthSession } from "@/lib/auth/supabaseAuth";
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
  isSessionProgressStateKey,
  isSharedStateKvKey,
  SHARED_LECTURE_TREE_KEY,
  SHARED_META_MAP_PREFIX,
} from "@/lib/shared/sharedStateKeys";
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";

const PUSH_DEBOUNCE_MS = 700;
const PUSH_RETRY_BACKOFF_MS = [3000, 10000, 30000] as const;
const MAX_PUSH_RETRIES = PUSH_RETRY_BACKOFF_MS.length;
const AUTH_KEY = "tutorweb_auth_session_v1";
const LEGACY_CONSULT_STORE_KEY = "tutorweb_consultations_v1";
const CALENDAR_SYNC_INITIAL_DELAY_MS = 1500;

const PENING_LOCK_TIMEOUT_MS = 5000;

export function decideNextPushRetryDelayMs(args: {
  stateKvSynced: boolean;
  nonRetryable?: boolean;
  attemptCount: number;
}): number | null {
  if (args.stateKvSynced) return null;
  if (args.nonRetryable) return null;
  if (args.attemptCount >= MAX_PUSH_RETRIES) return null;
  return PUSH_RETRY_BACKOFF_MS[args.attemptCount] ?? PUSH_RETRY_BACKOFF_MS[PUSH_RETRY_BACKOFF_MS.length - 1];
}

function shouldSkipAutoHydrateOnCurrentPath(): boolean {
  if (typeof window === "undefined") return false;
  const p = window.location.pathname || "/";
  return (
    p === "/" ||
    p.startsWith("/auth/") ||
    p.startsWith("/programs") ||
    p.startsWith("/policy")
  );
}

export default function SharedSnapshotAgent() {
  const hydratingRef = useRef(false);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const calendarSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStateKvRef = useRef<Record<string, string>>({});
  const pendingLockedAtRef = useRef<number | null>(null);
  const pushRetryCountRef = useRef(0);
  const calendarSyncKeyRef = useRef("");

  useEffect(() => {
    // 상담 정책 제거: 로컬 레거시 상담 저장소를 정리한다.
    try {
      window.localStorage.removeItem(LEGACY_CONSULT_STORE_KEY);
    } catch {
      // no-op
    }

    const trySyncCalendarForCurrentLogin = (delayMs = 0) => {
      if (calendarSyncTimerRef.current) {
        clearTimeout(calendarSyncTimerRef.current);
        calendarSyncTimerRef.current = null;
      }

      const executeSync = () => {
        const auth = loadAuthSession();
        if (!auth?.email || !auth?.providerAccessToken || isProviderTokenExpired(auth)) {
          // 로그아웃, 토큰 소실 또는 만료 시 다음 로그인에서 다시 1회 동기화되도록 키를 초기화
          calendarSyncKeyRef.current = "";
          return;
        }
        const syncKey = `${auth.email.toLowerCase()}::${auth.userId ?? ""}`;
        if (calendarSyncKeyRef.current === syncKey) return;
        calendarSyncKeyRef.current = syncKey;
        syncGoogleCalendarForExistingSessions();
      };

      if (delayMs > 0) {
        calendarSyncTimerRef.current = setTimeout(executeSync, delayMs);
      } else {
        executeSync();
      }
    };

    const hydrate = async (forceRemote = false) => {
      if (hydratingRef.current) return;
      if (Object.keys(pendingStateKvRef.current).length > 0) {
        const lockedAt = pendingLockedAtRef.current;
        if (lockedAt !== null && Date.now() - lockedAt > PENING_LOCK_TIMEOUT_MS) {
          pendingLockedAtRef.current = null;
          schedulePush(PUSH_RETRY_BACKOFF_MS[0]);
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

      const handleFailure = (nonRetryable?: boolean, httpStatus?: number) => {
        const nextDelay = decideNextPushRetryDelayMs({
          stateKvSynced: false,
          nonRetryable,
          attemptCount: pushRetryCountRef.current,
        });
        if (nextDelay === null) {
          pushRetryCountRef.current = 0;
          console.warn(
            `[SharedSnapshotAgent] stateKv 동기화 재시도 중단 (${nonRetryable ? `HTTP ${httpStatus ?? "4xx"} 권한/요청 거절` : `최대 재시도 ${MAX_PUSH_RETRIES}회 초과`})`
          );
          return;
        }
        pushRetryCountRef.current += 1;
        if (Object.keys(pendingStateKvRef.current).length === 0) {
          pendingLockedAtRef.current = Date.now();
        }
        pendingStateKvRef.current = { ...pending, ...pendingStateKvRef.current };
        schedulePush(nextDelay);
      };

      void pushSharedSnapshot({ stateKv: pending })
        .then((result) => {
          if (result.stateKvSynced) {
            pushRetryCountRef.current = 0;
            return;
          }
          handleFailure(result.nonRetryable, result.httpStatus);
        })
        .catch(() => {
          handleFailure(false);
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
      pushRetryCountRef.current = 0;
      if (Object.keys(pendingStateKvRef.current).length === 0) {
        pendingLockedAtRef.current = Date.now();
      }
      pendingStateKvRef.current[key] = newValue;
      schedulePush();
    };

    const onAuthChanged = () => {
      if (shouldSkipAutoHydrateOnCurrentPath()) return;
      trySyncCalendarForCurrentLogin(300);
      void hydrate(true);
    };

    // [Vercel 비용 최적화] 정기 폴링(Interval) 대신 탭 활성화 시 전용 동기화(Focus Sync)로 전환
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        if (shouldSkipAutoHydrateOnCurrentPath()) return;
        console.log("[Phase 21 On-Demand] 탭 활성화 감지 - 서버 데이터 갱신 시작");
        void hydrate(true); 
      }
    };

    // 초기 실행 시 서버 데이터 동기화 및 캘린더 동기화 백그라운드 지연 실행
    if (!shouldSkipAutoHydrateOnCurrentPath()) {
      void hydrate(true);
      trySyncCalendarForCurrentLogin(CALENDAR_SYNC_INITIAL_DELAY_MS);
    }

    const onPageHide = () => {
      if (pushTimerRef.current) {
        clearTimeout(pushTimerRef.current);
        pushTimerRef.current = null;
      }
      if (calendarSyncTimerRef.current) {
        clearTimeout(calendarSyncTimerRef.current);
        calendarSyncTimerRef.current = null;
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
        if (key === SHARED_LECTURE_TREE_KEY) window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.lectureTreeUpdated));
        if (key.startsWith(SHARED_META_MAP_PREFIX)) window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.metaMapUpdated));
        if (isSessionProgressStateKey(key)) window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.sessionProgressUpdated));
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
      if (calendarSyncTimerRef.current) {
        clearTimeout(calendarSyncTimerRef.current);
        calendarSyncTimerRef.current = null;
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

