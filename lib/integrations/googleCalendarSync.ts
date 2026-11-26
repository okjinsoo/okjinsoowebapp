"use client";

import { isProviderTokenExpired, loadAuthSession } from "@/lib/auth/supabaseAuth";
import { readSnapshotServerFirst } from "@/lib/storage/serverRead";
import type { Session, SessionMeta, Student } from "@/lib/types/index";
import { buildBaseDatesISO, getEffectiveMetaMap } from "@/lib/storage/sessionMeta";
import { computeEffectiveISO } from "@/lib/factories/sessionFactories";
import {
  calendarIdOf,
  delay,
  hasDisplayAtChanged,
  isPermissionOrNotFound,
  isPrimaryCalendarId,
  isValidEmail,
  normalizeEmail,
  partitionSyncTargetsForMeetSafety,
  runWithConcurrencyLimit,
  safeIso,
  sessionNeedsUpsert,
  shouldCreateFor,
  text,
} from "@/lib/integrations/googleCalendarCore";
import {
  createEvent,
  deleteEvent,
  DUPLICATE_TIME_WINDOW_MS,
  ensureAppCalendarIdWithRecovery,
  findSessionEvents,
  findSignatureEvents,
  loadRecentCreatedEvent,
  purgeManagedEventsForStudent,
  saveRecentCreatedEvent,
  updateEvent,
  upsertStudentMirrorEvent,
} from "@/lib/integrations/googleCalendarApi";

// 기존에 이 파일에서 가져가던 이름들은 그대로 유지합니다.
export {
  APP_EVENT_MARKER,
  isGoogleRateLimitError,
  partitionSyncTargetsForMeetSafety,
  runWithConcurrencyLimit,
} from "@/lib/integrations/googleCalendarCore";
export { requestGoogle } from "@/lib/integrations/googleCalendarApi";

function filterVisibleSessions(student: Student, sessions: Session[]): Session[] {
  void student;
  return sessions;
}

type SessionPatch = {
  id: string;
  patch: Partial<Session>;
};

type StudentPatch = {
  id: string;
  patch: Partial<import("@/lib/types/index").Student>;
};

type SyncArgs = {
  previous: Session[];
  next: Session[];
  applyPatches: (patches: SessionPatch[]) => void;
  applyStudentPatch?: (patches: StudentPatch[]) => void;
};

const SYNC_DEBOUNCE_MS = 900;
const SYNC_CONCURRENCY_LIMIT = 3;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let pending: SyncArgs | null = null;
let syncInFlight = false;
async function runStudentMirrorSync(args: {
  studentIds: string[];
  sessions: Session[];
}): Promise<void> {
  void args;
  // 현재는 mirror 생성을 비활성화했지만, 복구 시 참고를 위해 함수 구현은 보존한다.
  void purgeManagedEventsForStudent;
  void upsertStudentMirrorEvent;
  // [26.03.10] 선생님의 메인 코어 이벤트가 자동 참석자 초대를 통해 단일 Event(Singluar Truth)로 기능하므로,
  // 강제로 학생 측 캘린더에 별도의 'Mirror(보조 일정)'을 생성하여 Google Meet 채널이 두 개로 갈라지는 증상을 방지하기 위해 로직을 무력화합니다.
  return;
}

export function syncStudentGoogleCalendarMirror(args: {
  studentIds: string[];
  sessions: Session[];
}): void {
  void runStudentMirrorSync(args);
}

async function runTeacherCalendarRebuild(args: {
  studentIds: string[];
  sessions: Session[];
  applyPatches: (patches: SessionPatch[]) => void;
  applyStudentPatch?: (patches: StudentPatch[]) => void;
}): Promise<void> {
  const auth = loadAuthSession();
  const providerToken = text(auth?.providerAccessToken);
  const currentEmail = normalizeEmail(auth?.email);
  if (!providerToken || !currentEmail || isProviderTokenExpired(auth)) {
    return;
  }

  const targetStudentIds = new Set(
    (args.studentIds ?? []).map((id) => text(id)).filter(Boolean)
  );
  if (targetStudentIds.size === 0) return;

  const snapshot = await readSnapshotServerFirst();
  const students = snapshot.students;
  const teachers = snapshot.teachers;
  const studentById = new Map(students.map((student) => [student.id, student] as const));
  const teacherById = new Map(teachers.map((teacher) => [teacher.id, teacher] as const));
  const sessionsByStudent = new Map<string, Session[]>();
  const patches: SessionPatch[] = [];

  for (const session of args.sessions ?? []) {
    if (!targetStudentIds.has(session.studentId)) continue;
    const bucket = sessionsByStudent.get(session.studentId) ?? [];
    bucket.push(session);
    sessionsByStudent.set(session.studentId, bucket);
  }

  for (const [studentId, rows] of sessionsByStudent.entries()) {
    const student = studentById.get(studentId);
    if (!student) continue;
    const teacher = student.teacherId ? teacherById.get(student.teacherId) ?? null : null;
    const ownerEmail = normalizeEmail(teacher?.email);

    if (!teacher || !ownerEmail || !isValidEmail(ownerEmail)) {
      for (const session of rows) {
        patches.push({
          id: session.id,
          patch: {
            googleCalendarStatus: "error",
            googleCalendarError: "담당 선생님 이메일이 없어 캘린더를 다시 만들 수 없습니다.",
          },
        });
      }
      continue;
    }

    if (currentEmail !== ownerEmail) {
      for (const session of rows) {
        patches.push({
          id: session.id,
          patch: {
            googleCalendarStatus: "error",
            googleCalendarError: `담당 선생님 계정(${ownerEmail})으로 로그인한 뒤 다시 동기화해주세요.`,
          },
        });
      }
      continue;
    }

    try {
      const calendarId = await ensureAppCalendarIdWithRecovery({
        token: providerToken,
        ownerEmail,
      });

      // [중요] 일괄 삭제(purgeManagedEventsForStudent)는 401 에러나 타임아웃에 취약하고 누락 위험이 있습니다.
      // 대신 아래 개별 루프에서 findSessionEvents를 통해 확실하게 청소 및 입양을 진행합니다.

      const visibleRows = filterVisibleSessions(student, rows);
      const effectiveMetaMap = getEffectiveMetaMap({ token: student.token, stateKv: snapshot.stateKv });
      const baseDatesISOForStudent = buildBaseDatesISO(student, 120);

      const effectiveRows = visibleRows.map((s: Session) => {
        const { effectiveISO } = computeEffectiveISO({
          token: student.token,
          index: s.index,
          baseDatesISO: baseDatesISOForStudent,
          metaMap: effectiveMetaMap,
        });
        return { ...s, displayAt: effectiveISO || s.displayAt };
      });

      const orderedSessions = [...effectiveRows].sort((a, b) => {
        const ta = new Date(a.displayAt).getTime();
        const tb = new Date(b.displayAt).getTime();
        if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
        return a.index - b.index;
      });

      let studentPermanentMeet = text(student.permanentMeetUrl);
      let reusableConferenceData: Record<string, unknown> | null = null;

      for (const session of orderedSessions) {
        try {
          const meta = effectiveMetaMap[session.index];
          // 1. 강제 청소 및 입양 (Purge & Adopt):
          // 현재 세션ID 또는 꼬리표(이름+회차) 기준 모든 일정을 뒤져서 유령을 청소합니다.
          const allSessionEvents = await findSessionEvents({
            token: providerToken,
            calendarId,
            session,
            student,
          });

          const hasPermanentMeet = Boolean(studentPermanentMeet);
          let sessionToCreateOrUpdate = {
            ...session,
            // [방향 B]: 학생에게 이미 영구 링크가 있으면 그것을 쓰고, 없으면 과거 세션의 개별 링크를 비워 신규 발급 유도
            googleMeetUrl: hasPermanentMeet ? studentPermanentMeet : undefined,
          };
          if (allSessionEvents.length > 0) {
            await delay(100);
            const currentStartMs = new Date(safeIso(session.displayAt) ?? 0).getTime();
            // 가장 가까운 시간을 찾거나, 없으면 첫 번째 일정을 입양(나중에 PATCH로 이동됨)
            const matchingCurrentTime = allSessionEvents.find(ev => {
              const evStartMs = new Date(ev.startIso ?? 0).getTime();
              return Math.abs(evStartMs - currentStartMs) <= DUPLICATE_TIME_WINDOW_MS;
            });
            const canonicalId = matchingCurrentTime?.eventId ?? allSessionEvents[0].eventId;

            sessionToCreateOrUpdate = {
              ...sessionToCreateOrUpdate,
              googleCalendarEventId: canonicalId ?? undefined,
              // [방향 B]: 과거 캘린더 일정(canonicalEvent)의 meetUrl을 절대 입양하지 않고 학생 영구 링크로 고정
              googleMeetUrl: hasPermanentMeet ? studentPermanentMeet : undefined,
            };

            // 기준 외의 모든 유령 삭제
            const duplicates = allSessionEvents.filter(ev => ev.eventId !== canonicalId);
            for (const dup of duplicates) {
              try {
                await deleteEvent({
                  token: providerToken,
                  calendarId,
                  eventId: dup.eventId,
                  sendUpdates: "none",
                });
              } catch (err) {
                console.warn(`[Rebuild-Purge] 유령 일정 삭제 실패: ${dup.eventId}`, err);
              }
            }
          }

          let result: {
            eventId: string | null;
            meetUrl: string | null;
            conferenceData: Record<string, unknown> | null;
          };
          if (sessionToCreateOrUpdate.googleCalendarEventId) {
            result = await updateEvent({
              token: providerToken,
              calendarId,
              session: sessionToCreateOrUpdate,
              student,
              teacher,
              meta,
              conferenceDataToReuse: reusableConferenceData,
            });
          } else {
            result = await createEvent({
              token: providerToken,
              calendarId,
              session: {
                ...sessionToCreateOrUpdate,
                googleCalendarEventId: undefined,
                googleMeetUrl: hasPermanentMeet ? studentPermanentMeet : undefined,
              },
              student,
              teacher,
              meta,
              sendUpdates: "none",
              conferenceDataToReuse: reusableConferenceData,
            });
          }
          if (!result.eventId) {
            throw new Error("유효한 수업 시간이 없어 캘린더 일정을 만들지 못했습니다.");
          }

          // 새로 발급된 Meet 링크를 student.permanentMeetUrl에 저장 및 다음 회차에서 재사용 (최초 1회)
          if (result.meetUrl && !studentPermanentMeet) {
            studentPermanentMeet = result.meetUrl;
            (student as import("@/lib/types/index").Student).permanentMeetUrl = result.meetUrl;
            if (result.conferenceData) {
              reusableConferenceData = result.conferenceData;
            }
            if (args.applyStudentPatch) {
              args.applyStudentPatch([{ id: student.id, patch: { permanentMeetUrl: result.meetUrl } }]);
            }
          }

          // 학생의 영구 Meet 링크가 결정되면 모든 회차는 무조건 그 링크로 통일!
          const finalMeetUrl = studentPermanentMeet || result.meetUrl || undefined;
          patches.push({
            id: session.id,
            patch: {
              googleCalendarId: calendarId,
              googleCalendarEventId: result.eventId ?? undefined,
              googleMeetUrl: finalMeetUrl,
              googleCalendarOwnerEmail: ownerEmail,
              googleCalendarStatus: "synced",
              googleCalendarError: "",
              googleCalendarSyncedAt: new Date().toISOString(),
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Google Calendar 동기화 실패";
          patches.push({
            id: session.id,
            patch: {
              googleCalendarId: calendarId,
              googleCalendarEventId: undefined,
              googleMeetUrl: undefined,
              googleCalendarOwnerEmail: ownerEmail,
              googleCalendarStatus: "error",
              googleCalendarError: message,
            },
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Google Calendar 동기화 실패";
      for (const session of rows) {
        patches.push({
          id: session.id,
          patch: {
            googleCalendarStatus: "error",
            googleCalendarError: message,
          },
        });
      }
    }
  }

  if (patches.length > 0) {
    args.applyPatches(patches);
  }
}

export function rebuildTeacherGoogleCalendar(args: {
  studentIds: string[];
  sessions: Session[];
  applyPatches: (patches: SessionPatch[]) => void;
  applyStudentPatch?: (patches: StudentPatch[]) => void;
}): void {
  void runTeacherCalendarRebuild(args);
}

async function runSync(args: SyncArgs): Promise<void> {
  const snapshot = await readSnapshotServerFirst();
  const students = snapshot.students;
  const studentById = new Map(students.map((s) => [s.id, s] as const));
  const stateKv = snapshot.stateKv;

  // [성능 최적화] 학생당 baseDatesISO와 metaMap을 단 1회만 계산하여 세션 개수만큼 중복 계산하던 CPU 병목 제거
  const baseDatesByStudentId = new Map<string, string[]>();
  const metaMapByStudentId = new Map<string, Record<number, SessionMeta>>();

  const correctedNext = args.next.map((s) => {
    const student = studentById.get(s.studentId);
    if (!student) return s;
    let baseDatesISO = baseDatesByStudentId.get(student.id);
    if (!baseDatesISO) {
      baseDatesISO = buildBaseDatesISO(student, 120);
      baseDatesByStudentId.set(student.id, baseDatesISO);
    }
    let effectiveMetaMap = metaMapByStudentId.get(student.id);
    if (!effectiveMetaMap) {
      effectiveMetaMap = getEffectiveMetaMap({ token: student.token, stateKv });
      metaMapByStudentId.set(student.id, effectiveMetaMap);
    }
    const { effectiveISO } = computeEffectiveISO({
      token: student.token,
      index: s.index,
      baseDatesISO,
      metaMap: effectiveMetaMap,
    });
    return { ...s, displayAt: effectiveISO || s.displayAt };
  });

  const previousById = new Map(args.previous.map((s) => [s.id, s] as const));
  const nextById = new Map(correctedNext.map((s) => [s.id, s] as const));
  const provisionalTargets = correctedNext.filter((next) => {
    const prev = previousById.get(next.id);
    const status = text(next.googleCalendarStatus);
    if (status === "pending" || status === "error") return true;
    if (!sessionNeedsUpsert(prev, next)) return false;
    if (!next.googleCalendarEventId && !shouldCreateFor(next)) return false;
    return true;
  });

  const applySyncErrorToTargets = (message: string) => {
    if (provisionalTargets.length === 0) return;
    args.applyPatches(
      provisionalTargets.map((session) => ({
        id: session.id,
        patch: {
          googleCalendarStatus: "error",
          googleCalendarError: message,
        },
      }))
    );
  };

  const auth = loadAuthSession();
  const providerToken = text(auth?.providerAccessToken);
  const currentEmail = normalizeEmail(auth?.email);
  if (!providerToken || isProviderTokenExpired(auth)) {
    applySyncErrorToTargets(
      !providerToken
        ? "구글 캘린더 권한 토큰이 없습니다. 홈에서 구글 권한을 다시 연결해주세요."
        : "구글 캘린더 권한 토큰이 만료되었습니다. 홈의 '구글 권한 다시 연결' 버튼을 눌러주세요."
    );
    return;
  }
  if (!currentEmail) {
    applySyncErrorToTargets("현재 로그인 이메일을 확인할 수 없습니다. 다시 로그인 해주세요.");
    return;
  }

  const teachers = snapshot.teachers;
  const teacherById = new Map(teachers.map((t) => [t.id, t] as const));
  const patches: SessionPatch[] = [];

  const { resolveUserRole } = await import("@/lib/auth/roleAuth");
  const userRole = await resolveUserRole({ email: auth?.email, accessToken: auth?.accessToken });
  if (userRole === "student") {
    console.log("[Calendar Sync] 학생 권한은 캘린더 동기화 기능을 사용하지 않습니다. (Phase 18 권한 격리)");
    return;
  }

  const visibleNextSessions: Session[] = [];
  for (const student of students) {
    const studentSessions = correctedNext.filter((s) => s.studentId === student.id);
    visibleNextSessions.push(...filterVisibleSessions(student, studentSessions));
  }
  const visibleSet = new Set(visibleNextSessions.map((s) => s.id));

  const targetSessions = visibleNextSessions.filter((next) => {
    const prev = previousById.get(next.id);
    const status = text(next.googleCalendarStatus);
    const statusDriven = status === "pending" || status === "error";
    const diffDriven = sessionNeedsUpsert(prev, next);

    const student = studentById.get(next.studentId);
    const teacher = student?.teacherId ? teacherById.get(student.teacherId) ?? null : null;
    const expectedOwnerEmail = normalizeEmail(teacher?.email);
    const savedOwnerEmail = normalizeEmail(next.googleCalendarOwnerEmail);
    const ownerDrift = Boolean(expectedOwnerEmail) && expectedOwnerEmail !== savedOwnerEmail;

    const permanentMeet = text(student?.permanentMeetUrl);
    const sessionMeet = text(next.googleMeetUrl);
    const meetDrift = Boolean(permanentMeet) && permanentMeet !== sessionMeet;

    if (!statusDriven && !diffDriven && !ownerDrift && !meetDrift) return false;
    if (!next.googleCalendarEventId && !shouldCreateFor(next) && !statusDriven && !ownerDrift && !meetDrift) return false;
    return true;
  });

  for (const prev of args.previous) {
    if (visibleSet.has(prev.id)) continue;
    if (!prev.googleCalendarEventId) continue;
    const prevStudent = studentById.get(prev.studentId);
    const prevTeacher = prevStudent?.teacherId ? teacherById.get(prevStudent.teacherId) ?? null : null;
    const expectedOwnerEmail = normalizeEmail(prevTeacher?.email);
    if (!expectedOwnerEmail || expectedOwnerEmail !== currentEmail) continue;
    const prevCalendarId = calendarIdOf(prev);
    if (isPrimaryCalendarId(prevCalendarId)) continue;
    try {
      await deleteEvent({
        token: providerToken,
        calendarId: prevCalendarId,
        eventId: prev.googleCalendarEventId,
      });
      if (nextById.has(prev.id)) {
        patches.push({
          id: prev.id,
          patch: {
            googleCalendarId: undefined,
            googleCalendarEventId: undefined,
            googleMeetUrl: undefined,
            googleCalendarOwnerEmail: undefined,
            googleCalendarStatus: "synced",
            googleCalendarError: "",
          },
        });
      }
    } catch (err) {
      console.error("Google Calendar 이벤트 삭제 실패:", err);
    }
  }

  const orderedTargets = [...targetSessions].sort((a, b) => {
    const ta = new Date(a.displayAt).getTime();
    const tb = new Date(b.displayAt).getTime();
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    return a.index - b.index;
  });

  const studentPermanentMeetMap = new Map<string, string>();
  const studentConferenceDataMap = new Map<string, Record<string, unknown>>();
  // 토큰이 중간에 자동 갱신(401 복구)되면 병렬 워커들이 즉시 새 토큰을 쓰도록 동적 조회
  const getActiveProviderToken = (): string =>
    text(loadAuthSession()?.providerAccessToken) || providerToken;
  // [C단계 최적화] 같은 선생님 캘린더 존재 확인(GET /calendars/:id)은 동기화 배치당 1회만 수행하고 Promise 공유
  const verifiedCalendarPromiseByOwner = new Map<string, Promise<string>>();
  const getVerifiedTargetCalendarId = (ownerEmail: string): Promise<string> => {
    const existing = verifiedCalendarPromiseByOwner.get(ownerEmail);
    if (existing) return existing;
    const promise = ensureAppCalendarIdWithRecovery({
      token: getActiveProviderToken(),
      ownerEmail,
    }).catch((err) => {
      verifiedCalendarPromiseByOwner.delete(ownerEmail);
      throw err;
    });
    verifiedCalendarPromiseByOwner.set(ownerEmail, promise);
    return promise;
  };

  const syncSingleTarget = async (next: Session): Promise<void> => {
    const prev = previousById.get(next.id);
    const student = studentById.get(next.studentId);
    if (!student) {
      patches.push({
        id: next.id,
        patch: {
          googleCalendarStatus: "error",
          googleCalendarError: "학생 정보를 찾지 못해 캘린더 동기화가 중단되었습니다.",
        },
      });
      return;
    }

    const teacher = student.teacherId ? teacherById.get(student.teacherId) ?? null : null;
    const teacherEmail = normalizeEmail(teacher?.email);
    const ownerEmail = teacherEmail;
    const savedOwnerEmail = normalizeEmail(next.googleCalendarOwnerEmail);
    const ownerMismatch = Boolean(savedOwnerEmail && savedOwnerEmail !== ownerEmail);
    const scheduleChanged = sessionNeedsUpsert(prev, next);

    if (!teacher || !ownerEmail || !isValidEmail(ownerEmail)) {
      patches.push({
        id: next.id,
        patch: {
          googleCalendarId: undefined,
          googleCalendarEventId: undefined,
          googleMeetUrl: undefined,
          googleCalendarOwnerEmail: undefined,
          googleCalendarStatus: "error",
          googleCalendarError: "담당 선생님 이메일이 없어서 Meet를 만들 수 없습니다. 관리자에게 문의해주세요.",
        },
      });
      return;
    }

    if (ownerEmail !== currentEmail) {
      // 과거에 잘못된 소유자로 저장된 이벤트가 현재 로그인 계정 소유라면 정리
      if (ownerMismatch && savedOwnerEmail === currentEmail && next.googleCalendarEventId) {
        const nextCalendarId = calendarIdOf(next);
        if (!isPrimaryCalendarId(nextCalendarId)) {
          try {
            await deleteEvent({
              token: providerToken,
              calendarId: nextCalendarId,
              eventId: next.googleCalendarEventId,
            });
          } catch (err) {
            console.error("잘못된 소유자 이벤트 정리 실패:", err);
          }
        }
      }

      const hasReadyMeet =
        Boolean(text(next.googleCalendarEventId)) && Boolean(text(next.googleMeetUrl));
      const isSyncedStatus = text(next.googleCalendarStatus) === "synced";
      const permanentMeet = text(student.permanentMeetUrl);
      const meetMatchesPermanent = !permanentMeet || text(next.googleMeetUrl) === permanentMeet;
      // 비소유자 계정에서도 "변경 없음 + 이미 동기화 완료 + 영구 링크 일치"인 경우만 그대로 둡니다.
      // 일정이 바뀌었거나 Meet 링크가 영구 링크와 다르면 반드시 pending으로 내려서 담당 선생님 재동기화를 유도합니다.
      if (!ownerMismatch && hasReadyMeet && isSyncedStatus && !scheduleChanged && meetMatchesPermanent) {
        return;
      }

      patches.push({
        id: next.id,
        patch: {
          googleCalendarOwnerEmail: ownerEmail,
          googleCalendarId: ownerMismatch ? undefined : next.googleCalendarId,
          googleCalendarEventId: ownerMismatch ? undefined : next.googleCalendarEventId,
          googleMeetUrl: ownerMismatch ? undefined : next.googleMeetUrl,
          googleCalendarStatus: "pending",
          googleCalendarError: "이 회차 Meet는 담당 선생님 계정으로 로그인해야 생성됩니다.",
        },
      });
      return;
    }

    try {
      const targetCalendarId = await getVerifiedTargetCalendarId(ownerEmail);
      const activeToken = getActiveProviderToken();

      const permanentFromStudent = text(student.permanentMeetUrl);
      let effectivePermanentMeet = studentPermanentMeetMap.get(student.id) || permanentFromStudent;
      const reusableConferenceData = studentConferenceDataMap.get(student.id) || null;
      const hasStudentPermanentMeet = Boolean(effectivePermanentMeet);

      let sessionForOwner: Session = ownerMismatch
        ? {
          ...next,
          googleCalendarId: targetCalendarId,
          googleCalendarEventId: undefined,
          googleMeetUrl: hasStudentPermanentMeet ? effectivePermanentMeet : undefined,
        }
        : {
          ...next,
          // [방향 B]: 학생 영구 링크가 있으면 그것으로 통일, 없으면 과거 회차 링크를 비워 신규 발급 유도
          googleMeetUrl: hasStudentPermanentMeet ? effectivePermanentMeet : undefined,
        };
      let sessionCalendarId = calendarIdOf(sessionForOwner);

      if (sessionCalendarId !== targetCalendarId) {
        const canCleanupCurrentCalendar = !isPrimaryCalendarId(sessionCalendarId);
        // 캘린더 이동(primary -> 앱 전용) 시, 이전 캘린더에 남아있는 같은 회차 이벤트를 먼저 정리
        let cleanedBySignature = false;
        if (canCleanupCurrentCalendar) {
          try {
            const staleEvents = await findSignatureEvents({
              token: activeToken,
              calendarId: sessionCalendarId,
              session: sessionForOwner,
              student,
            });
            if (staleEvents.length > 0) {
              cleanedBySignature = true;
            }
            for (const stale of staleEvents) {
              try {
                await deleteEvent({
                  token: activeToken,
                  calendarId: sessionCalendarId,
                  eventId: stale.eventId,
                  sendUpdates: "none",
                });
              } catch (err) {
                console.error("Google Calendar 캘린더 이동 중 이전 캘린더 이벤트 정리 실패:", err);
              }
            }
          } catch (err) {
            console.error("Google Calendar 캘린더 이동 중 이전 캘린더 이벤트 조회 실패:", err);
          }
        }

        if (canCleanupCurrentCalendar && !cleanedBySignature && sessionForOwner.googleCalendarEventId) {
          try {
            await deleteEvent({
              token: activeToken,
              calendarId: sessionCalendarId,
              eventId: sessionForOwner.googleCalendarEventId,
              sendUpdates: "none",
            });
          } catch (err) {
            console.error("Google Calendar 캘린더 이동 중 기존 이벤트 삭제 실패:", err);
          }
        }
        sessionForOwner = {
          ...sessionForOwner,
          googleCalendarId: targetCalendarId,
          googleCalendarEventId: undefined,
          googleMeetUrl: undefined,
        };
        sessionCalendarId = targetCalendarId;
      }

      if (prev && hasDisplayAtChanged(prev, next)) {
        console.log(`[Google Calendar] 일정 변경 감지됨: ${student.name} ${next.index}회차. PATCH 이동 처리 예정.`);
      }

      if (!sessionForOwner.googleCalendarEventId) {
        const recentEventId = loadRecentCreatedEvent({
          ownerEmail,
          sessionId: sessionForOwner.id,
        });
        if (recentEventId) {
          sessionForOwner = {
            ...sessionForOwner,
            googleCalendarEventId: recentEventId,
          };
        }
      }

      // [C단계 핵심 가속] 동일 소유자·동일 캘린더에 이미 eventId가 정상 연결되어 있으면
      // 불필요한 사전 검색(findSessionEvents GET + 100ms 대기)을 생략하고 바로 PATCH로 직행한다.
      // (404/403이 발생할 경우 아래 catch 분기에서 자동 복구)
      const canDirectPatchExistingEvent =
        !ownerMismatch &&
        sessionCalendarId === targetCalendarId &&
        Boolean(sessionForOwner.googleCalendarEventId) &&
        text(next.googleCalendarStatus) !== "error";

      if (!canDirectPatchExistingEvent) {
        // 1. 강제 청소 및 입양 (Purge & Adopt):
        // 현재 세션 ID 또는 시그니처(이름+회차)를 가진 모든 일정을 찾습니다. (시간 창에 구애받지 않음)
        const allSessionEvents = await findSessionEvents({
          token: activeToken,
          calendarId: sessionCalendarId,
          session: sessionForOwner,
          student,
        });

        if (allSessionEvents.length > 0) {
          await delay(100);
          const currentStartMs = new Date(safeIso(sessionForOwner.displayAt) ?? 0).getTime();

          let canonicalId = sessionForOwner.googleCalendarEventId;
          const matchingCurrentTime = allSessionEvents.find(ev => {
            const evStartMs = new Date(ev.startIso ?? 0).getTime();
            return Math.abs(evStartMs - currentStartMs) <= DUPLICATE_TIME_WINDOW_MS;
          });

          if (!canonicalId) {
            canonicalId = matchingCurrentTime?.eventId ?? allSessionEvents[0].eventId;
            sessionForOwner = {
              ...sessionForOwner,
              googleCalendarEventId: canonicalId ?? undefined,
              googleMeetUrl: hasStudentPermanentMeet ? effectivePermanentMeet : undefined,
            };
          }

          const duplicates = allSessionEvents.filter(ev => ev.eventId !== canonicalId);
          for (const dup of duplicates) {
            try {
              await deleteEvent({
                token: activeToken,
                calendarId: sessionCalendarId,
                eventId: dup.eventId,
                sendUpdates: "none",
              });
              console.log(`[Purge] 중복/유령 일정 삭제 성공: ${student.name} ${next.index}회차 (${dup.startIso})`);
            } catch (err) {
              console.error(`[Purge] 중복/유령 일정 삭제 실패: ${dup.eventId}`, err);
            }
          }
        }
      }

      const studentMetaMap =
        metaMapByStudentId.get(student.id) ??
        getEffectiveMetaMap({ token: student.token, stateKv });
      const currentMeta = studentMetaMap[next.index];

      let result: {
        eventId: string | null;
        meetUrl: string | null;
        conferenceData: Record<string, unknown> | null;
      };
      if (sessionForOwner.googleCalendarEventId) {
        try {
          result = await updateEvent({
            token: activeToken,
            calendarId: sessionCalendarId,
            session: sessionForOwner,
            student,
            teacher,
            meta: currentMeta,
            conferenceDataToReuse: reusableConferenceData,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Google Calendar 동기화 실패";
          if (isPermissionOrNotFound(message)) {
            // 과거 다른 계정에서 만든 eventId 또는 삭제된 일정이면 새 이벤트로 안전 복구
            result = await createEvent({
              token: activeToken,
              calendarId: sessionCalendarId,
              session: {
                ...sessionForOwner,
                googleCalendarEventId: undefined,
                googleMeetUrl: hasStudentPermanentMeet ? effectivePermanentMeet : undefined,
              },
              student,
              teacher,
              meta: currentMeta,
              conferenceDataToReuse: reusableConferenceData,
            });
          } else {
            throw err;
          }
        }
      } else {
        result = await createEvent({
          token: activeToken,
          calendarId: sessionCalendarId,
          session: {
            ...sessionForOwner,
            googleMeetUrl: hasStudentPermanentMeet ? effectivePermanentMeet : undefined,
          },
          student,
          teacher,
          meta: currentMeta,
          conferenceDataToReuse: reusableConferenceData,
        });
        if (result.eventId) {
          saveRecentCreatedEvent({
            ownerEmail,
            sessionId: sessionForOwner.id,
            eventId: result.eventId,
          });
        }
      }

      if (!result.eventId) {
        throw new Error("유효한 수업 시간이 없어 캘린더 일정을 만들지 못했습니다.");
      }

      // 새로 발급된 Meet 링크를 student.permanentMeetUrl에 저장 및 동일 학생 다른 회차에서 재사용 (최초 1회)
      if (result.meetUrl && !effectivePermanentMeet) {
        effectivePermanentMeet = result.meetUrl;
        studentPermanentMeetMap.set(student.id, result.meetUrl);
        (student as import("@/lib/types/index").Student).permanentMeetUrl = result.meetUrl;
        if (result.conferenceData) {
          studentConferenceDataMap.set(student.id, result.conferenceData);
        }
        if (args.applyStudentPatch) {
          args.applyStudentPatch([{ id: student.id, patch: { permanentMeetUrl: result.meetUrl } }]);
        }
      }

      // 학생의 영구 Meet 링크가 결정되면 모든 회차 세션은 무조건 그 링크로 통일!
      const finalMeetUrl = effectivePermanentMeet || result.meetUrl || undefined;

      // 같은 회차가 target 캘린더 외의 앱 캘린더에 남아 있으면 정리
      const staleCalendarIds = new Set<string>();
      staleCalendarIds.add(calendarIdOf(prev));
      staleCalendarIds.add(calendarIdOf(next));
      staleCalendarIds.delete("");
      staleCalendarIds.delete("primary");
      staleCalendarIds.delete(sessionCalendarId);
      for (const staleCalendarId of staleCalendarIds) {
        try {
          const staleEvents = await findSignatureEvents({
            token: activeToken,
            calendarId: staleCalendarId,
            session: sessionForOwner,
            student,
          });
          for (const stale of staleEvents) {
            try {
              await deleteEvent({
                token: activeToken,
                calendarId: staleCalendarId,
                eventId: stale.eventId,
                sendUpdates: "none",
              });
            } catch (err) {
              console.error("Google Calendar 비대상 캘린더 중복 정리 실패:", err);
            }
          }
        } catch (err) {
          console.error("Google Calendar 비대상 캘린더 중복 조회 실패:", err);
        }
      }

      patches.push({
        id: next.id,
        patch: {
          googleCalendarId: sessionCalendarId,
          googleCalendarEventId: result.eventId ?? undefined,
          googleMeetUrl: finalMeetUrl,
          googleCalendarOwnerEmail: ownerEmail,
          googleCalendarStatus: "synced",
          googleCalendarError: "",
          googleCalendarSyncedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Google Calendar 동기화 실패";
      patches.push({
        id: next.id,
        patch: {
          googleCalendarStatus: "error",
          googleCalendarError: message,
        },
      });
    }
  };

  // [C단계 안전 병렬 실행]
  // 1) 영구 Meet 링크가 아직 없는 학생의 첫 회차(seedTargets)만 먼저 직렬 실행해 단일 Meet 링크 확보
  // 2) 나머지 모든 회차(parallelTargets)는 동시 3개 제한으로 병렬 처리하여 캘린더 반영 속도 대폭 단축
  const { seedTargets, parallelTargets } = partitionSyncTargetsForMeetSafety(
    orderedTargets,
    studentById
  );
  for (const seed of seedTargets) {
    await syncSingleTarget(seed);
  }
  // seed 회차가 일시 오류로 Meet 링크를 못 얻은 학생은 중복 Meet 방 생성을 막기 위해 직렬 폴백으로 처리
  const readyParallelTargets: Session[] = [];
  const unseededSerialTargets: Session[] = [];
  for (const target of parallelTargets) {
    const st = studentById.get(target.studentId);
    const hasMeet = Boolean(
      (st && studentPermanentMeetMap.get(st.id)) || text(st?.permanentMeetUrl)
    );
    if (hasMeet || !st) {
      readyParallelTargets.push(target);
    } else {
      unseededSerialTargets.push(target);
    }
  }
  await runWithConcurrencyLimit(readyParallelTargets, SYNC_CONCURRENCY_LIMIT, syncSingleTarget);
  for (const fallbackTarget of unseededSerialTargets) {
    await syncSingleTarget(fallbackTarget);
  }

  if (patches.length > 0) {
    args.applyPatches(patches);
  }
}

async function flushPending(): Promise<void> {
  if (syncInFlight) return;
  if (!pending) return;

  syncInFlight = true;
  try {
    while (pending) {
      const job = pending;
      pending = null;
      await runSync(job);
    }
  } finally {
    syncInFlight = false;
  }
}

export function scheduleGoogleCalendarSync(args: SyncArgs): void {
  if (pending) {
    pending = {
      previous: pending.previous,
      next: args.next,
      applyPatches: args.applyPatches,
      applyStudentPatch: args.applyStudentPatch ?? pending.applyStudentPatch,
    };
  } else {
    pending = args;
  }

  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }

  syncTimer = setTimeout(() => {
    syncTimer = null;
    void flushPending();
  }, SYNC_DEBOUNCE_MS);
}
