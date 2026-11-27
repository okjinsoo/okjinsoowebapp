"use client";

import type { Session, SessionMeta, Student, Teacher } from "@/lib/types/index";
import { getEffectiveMetaMap } from "@/lib/storage/sessionMeta";
import {
  calendarIdOf,
  delay,
  hasDisplayAtChanged,
  isPermissionOrNotFound,
  isPrimaryCalendarId,
  isValidEmail,
  normalizeEmail,
  safeIso,
  sessionNeedsUpsert,
  text,
} from "@/lib/integrations/googleCalendarCore";
import {
  createEvent,
  deleteEvent,
  DUPLICATE_TIME_WINDOW_MS,
  findSessionEvents,
  findSignatureEvents,
  loadRecentCreatedEvent,
  saveRecentCreatedEvent,
  updateEvent,
} from "@/lib/integrations/googleCalendarApi";

/**
 * 회차 1개를 구글 캘린더와 맞추는 일만 담당하는 파일입니다.
 * (googleCalendarSync.ts의 runSync 안에 있던 syncSingleTarget을 그대로 옮겨왔습니다.)
 *
 * - 바깥 변수를 몰래 쓰지 않고, 필요한 재료는 모두 ctx(SyncTargetContext)로 받습니다.
 * - 결과는 "이 회차를 이렇게 고쳐 저장하라"는 SessionPatch로 돌려줍니다. 고칠 게 없으면 null.
 */

export type SessionPatch = {
  id: string;
  patch: Partial<Session>;
};

export type StudentPatch = {
  id: string;
  patch: Partial<Student>;
};

export type SyncTargetContext = {
  previousById: Map<string, Session>;
  studentById: Map<string, Student>;
  teacherById: Map<string, Teacher>;
  /** 지금 로그인한 계정 이메일(소문자 정리됨) */
  currentEmail: string;
  /** 동기화 시작 시점의 구글 토큰 */
  providerToken: string;
  /** 도중에 토큰이 자동 갱신되면 새 토큰을 돌려줍니다. */
  getActiveProviderToken: () => string;
  /** 선생님별 앱 전용 캘린더 ID (배치당 1회만 확인) */
  getVerifiedTargetCalendarId: (ownerEmail: string) => Promise<string>;
  /** 이번 배치에서 새로 받은 학생별 영구 Meet 링크 (회차끼리 공유) */
  studentPermanentMeetMap: Map<string, string>;
  studentConferenceDataMap: Map<string, Record<string, unknown>>;
  metaMapByStudentId: Map<string, Record<number, SessionMeta>>;
  stateKv: Parameters<typeof getEffectiveMetaMap>[0]["stateKv"];
  applyStudentPatch?: (patches: StudentPatch[]) => void;
};

export async function syncSingleTarget(ctx: SyncTargetContext, next: Session): Promise<SessionPatch | null> {
  const {
    previousById,
    studentById,
    teacherById,
    currentEmail,
    providerToken,
    getActiveProviderToken,
    getVerifiedTargetCalendarId,
    studentPermanentMeetMap,
    studentConferenceDataMap,
    metaMapByStudentId,
    stateKv,
  } = ctx;

  const prev = previousById.get(next.id);
  const student = studentById.get(next.studentId);
  if (!student) {
    return {
      id: next.id,
      patch: {
        googleCalendarStatus: "error",
        googleCalendarError: "학생 정보를 찾지 못해 캘린더 동기화가 중단되었습니다.",
      },
    };
  }

  const teacher = student.teacherId ? teacherById.get(student.teacherId) ?? null : null;
  const teacherEmail = normalizeEmail(teacher?.email);
  const ownerEmail = teacherEmail;
  const savedOwnerEmail = normalizeEmail(next.googleCalendarOwnerEmail);
  const ownerMismatch = Boolean(savedOwnerEmail && savedOwnerEmail !== ownerEmail);
  const scheduleChanged = sessionNeedsUpsert(prev, next);

  if (!teacher || !ownerEmail || !isValidEmail(ownerEmail)) {
    return {
      id: next.id,
      patch: {
        googleCalendarId: undefined,
        googleCalendarEventId: undefined,
        googleMeetUrl: undefined,
        googleCalendarOwnerEmail: undefined,
        googleCalendarStatus: "error",
        googleCalendarError: "담당 선생님 이메일이 없어서 Meet를 만들 수 없습니다. 관리자에게 문의해주세요.",
      },
    };
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
      return null;
    }

    return {
      id: next.id,
      patch: {
        googleCalendarOwnerEmail: ownerEmail,
        googleCalendarId: ownerMismatch ? undefined : next.googleCalendarId,
        googleCalendarEventId: ownerMismatch ? undefined : next.googleCalendarEventId,
        googleMeetUrl: ownerMismatch ? undefined : next.googleMeetUrl,
        googleCalendarStatus: "pending",
        googleCalendarError: "이 회차 Meet는 담당 선생님 계정으로 로그인해야 생성됩니다.",
      },
    };
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
      (student as Student).permanentMeetUrl = result.meetUrl;
      if (result.conferenceData) {
        studentConferenceDataMap.set(student.id, result.conferenceData);
      }
      if (ctx.applyStudentPatch) {
        ctx.applyStudentPatch([{ id: student.id, patch: { permanentMeetUrl: result.meetUrl } }]);
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

    return {
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
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Google Calendar 동기화 실패";
    return {
      id: next.id,
      patch: {
        googleCalendarStatus: "error",
        googleCalendarError: message,
      },
    };
  }
}
