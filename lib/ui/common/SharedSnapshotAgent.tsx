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
// [전송량 최적화] 역할별 기본 주기 정의
const PULL_INTERVAL_STUDENT_MS = 60000;  // 학생: 60초
const PULL_INTERVAL_TEACHER_MS = 10000;  // 선생님/관리자: 10초
const AUTH_KEY = "tutorweb_auth_session_v1";

const PENDING_LOCK_TIMEOUT_MS = 5000; // [최적화] pending 잠금 최대 유지 시간: 5초 초과 시 강제 해제

export default function SharedSnapshotAgent() {
  const hydratingRef = useRef(false);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStateKvRef = useRef<Record<string, string>>({});
  const pendingLockedAtRef = useRef<number | null>(null); // [최적화] pending 잠금 시작 시각
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
        // [최적화] pending 잠금이 5초를 초과하면 강제 해제하여 무한 차단 방지
        const lockedAt = pendingLockedAtRef.current;
        if (lockedAt !== null && Date.now() - lockedAt > PENDING_LOCK_TIMEOUT_MS) {
          console.warn("[SharedSnapshotAgent] pending 잠금 타임아웃 → 강제 해제 후 hydrate 재시도");
          pendingLockedAtRef.current = null;
          // 타임아웃된 pending은 다시 예약하여 재전송 시도
          schedulePush(PUSH_RETRY_MS);
        } else {
          return;
        }
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
      pendingLockedAtRef.current = null; // 잠금 해제
      if (Object.keys(pending).length === 0) return;

      void pushSharedSnapshot({ stateKv: pending })
        .then((result) => {
          if (result.stateKvSynced) return;
          // 재전송 필요 시 잠금 시작 시각 기록
          if (Object.keys(pendingStateKvRef.current).length === 0) {
            pendingLockedAtRef.current = Date.now();
          }
          pendingStateKvRef.current = {
            ...pending,
            ...pendingStateKvRef.current,
          };
          schedulePush(PUSH_RETRY_MS);
        })
        .catch((err) => {
          if (Object.keys(pendingStateKvRef.current).length === 0) {
            pendingLockedAtRef.current = Date.now();
          }
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
      // 새 데이터 추가 시 잠금 시작 시각 기록 (없을 때만)
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

    const onFocus = () => {
      void hydrate(true);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void hydrate(true);
      }
    };

    // [전송량 최적화] 역할에 따른 동기화 주기 설정
    const setupInterval = async () => {
      // 1. 초기 1회 강제 동기화 (최신 정보 확보)
      await hydrate(true);
      trySyncCalendarForCurrentLogin();

      const auth = loadAuthSession();
      if (!auth) return null;
      
      // pullSnapshot이 완료되었으므로 경로 기반으로 역할을 안전하게 추론
      const role = window.location.pathname.startsWith("/a/") ? "a" :
                   window.location.pathname.startsWith("/t/") ? "t" :
                   window.location.pathname.startsWith("/s/") ? "s" : "guest";

      if (role === "s") {
        console.log("[V18 최적화] 학생 모드 - 동기화 주기: 60초");
        return window.setInterval(() => {
          void hydrate(true);
        }, PULL_INTERVAL_STUDENT_MS);
      } else if (role === "t" || role === "a") {
        console.log(`[V18 최적화] ${role === "a" ? "관리자" : "선생님"} 모드 - 동기화 주기: 10초`);
        return window.setInterval(() => {
          void hydrate(true);
        }, PULL_INTERVAL_TEACHER_MS);
      }
      return null;
    };

    let intervalId: number | null = null;
    void setupInterval().then(id => { intervalId = id; });

    // [안전망] 탭/앱이 닫히거나 백그라운드로 전환될 때 pending 데이터를 즉시 전송
    const onPageHide = () => {
      if (pushTimerRef.current) {
        clearTimeout(pushTimerRef.current);
        pushTimerRef.current = null;
      }
      flushPending();
    };

    window.addEventListener(BROWSER_STORAGE_EVENT, onStorageChanged);
    window.addEventListener(AUTH_EVENT, onAuthChanged);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (intervalId !== null) window.clearInterval(intervalId);
      if (pushTimerRef.current) {
        clearTimeout(pushTimerRef.current);
        pushTimerRef.current = null;
      }
      window.removeEventListener(BROWSER_STORAGE_EVENT, onStorageChanged);
      window.removeEventListener(AUTH_EVENT, onAuthChanged);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
