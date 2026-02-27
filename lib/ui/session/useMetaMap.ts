// lib/ui/session/useMetaMap.ts
"use client";

import { useEffect, useMemo, useState } from "react";
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";
import { metaMapKey, readMetaMap, type SessionMeta } from "@/lib/ui/session/sessionEffective";

/**
 * 특정 token의 metaMap을 "자동 갱신"으로 제공하는 훅
 * - 같은 탭: TUTORWEB_EVENTS.metaMapUpdated (CustomEvent.detail.token)
 * - 다른 탭: storage 이벤트 (key가 tutorweb_metaMap_v1:... 일 때)
 */
export function useMetaMap(token: string): Record<number, SessionMeta> {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!token) return;

    const bump = () => setTick((x) => x + 1);

    const onMetaUpdated: EventListener = (e) => {
      const ce = e as CustomEvent<{ token?: string }>;
      const t = ce.detail?.token;
      if (!t || t === token) bump();
    };

    const onStorage: EventListener = (e) => {
      const se = e as StorageEvent;
      if (!se.key) return;
      // 다른 탭에서 metaMapKey(token)가 바뀌면 감지
      if (se.key === metaMapKey(token)) bump();
    };

    window.addEventListener(TUTORWEB_EVENTS.metaMapUpdated, onMetaUpdated);
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(TUTORWEB_EVENTS.metaMapUpdated, onMetaUpdated);
      window.removeEventListener("storage", onStorage);
    };
  }, [token]);

  return useMemo(() => {
    void tick;
    return readMetaMap(token);
  }, [token, tick]);
}

/**
 * "어떤 token이든 meta가 바뀌면" 다시 계산하게 해주는 신호 훅
 * - 여러 토큰을 한 화면에서 다룰 때 사용
 */
export function useMetaSignal(): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((x) => x + 1);

    const onMetaUpdated: EventListener = () => bump();

    const onStorage: EventListener = (e) => {
      const se = e as StorageEvent;
      if (!se.key) return;
      // metaMapKey(token) = tutorweb_metaMap_v1:${token}
      if (se.key.startsWith("tutorweb_metaMap_v1:")) bump();
    };

    window.addEventListener(TUTORWEB_EVENTS.metaMapUpdated, onMetaUpdated);
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(TUTORWEB_EVENTS.metaMapUpdated, onMetaUpdated);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return tick;
}
