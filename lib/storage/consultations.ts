// lib/storage/consultations.ts
"use client";

import { browserStorage } from "@/lib/storage/browserStorage";
import { safeParseJson } from "@/lib/storage/safeParse";
import type { ConsultationRecord, Id } from "@/lib/types/index";

const KEY = "tutorweb_consultations_v1";

type Store = Record<Id, ConsultationRecord[]>;

function loadAll(): Store {
  if (typeof window === "undefined") return {};
  return safeParseJson<Store>(browserStorage.getItem(KEY), {});
}

function saveAll(next: Store) {
  if (typeof window === "undefined") return;
  browserStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("tutorweb:consultationsUpdated"));
}

export function loadConsultationsByStudent(studentId: Id): ConsultationRecord[] {
  const all = loadAll();
  return all[studentId] ?? [];
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
