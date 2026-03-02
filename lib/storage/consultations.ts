// lib/storage/consultations.ts
"use client";

import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";
import { browserStorage } from "@/lib/storage/browserStorage";
import { pushSharedSnapshot } from "@/lib/storage/sharedSnapshot";
import { safeParseJson } from "@/lib/storage/safeParse";
import { SHARED_CONSULTATIONS_KEY } from "@/lib/storage/sharedStateKeys";
import type { ConsultationRecord, Id } from "@/lib/types/index";

const KEY = "tutorweb_consultations_v1";

type Store = Record<Id, ConsultationRecord[]>;
type SaveConsultationsOptions = {
  skipSharedSnapshot?: boolean;
};

function loadAll(): Store {
  if (typeof window === "undefined") return {};
  return safeParseJson<Store>(browserStorage.getItem(KEY), {});
}

function saveAll(next: Store, options?: SaveConsultationsOptions) {
  if (typeof window === "undefined") return;
  browserStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.consultationsUpdated));
  if (!options?.skipSharedSnapshot) {
    void pushSharedSnapshot({
      stateKv: {
        [SHARED_CONSULTATIONS_KEY]: JSON.stringify(next),
      },
    }).catch((err) => {
      console.error("공유 스냅샷 동기화 실패(consultations):", err);
    });
  }
}

function replaceByStudentLocal(studentId: Id, list: ConsultationRecord[]): boolean {
  if (typeof window === "undefined") return false;
  const all = loadAll();
  const prevRaw = JSON.stringify(all[studentId] ?? []);
  const nextRaw = JSON.stringify(list);
  if (prevRaw === nextRaw) return false;
  all[studentId] = list;
  saveAll(all);
  return true;
}

export function loadConsultationsByStudent(studentId: Id): ConsultationRecord[] {
  const all = loadAll();
  return all[studentId] ?? [];
}

export function loadAllConsultationsStore(): Store {
  return loadAll();
}

export function saveAllConsultationsStore(next: Store, options?: SaveConsultationsOptions): void {
  saveAll(next, options);
}


export function saveConsultationsByStudent(studentId: Id, list: ConsultationRecord[]) {
  const all = loadAll();
  all[studentId] = list;
  saveAll(all);
}

export function clearConsultationsByStudent(studentId: Id) {
  const all = loadAll();
  delete all[studentId];
  saveAll(all);
}
