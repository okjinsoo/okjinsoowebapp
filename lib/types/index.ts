// v1/lib/types/index.ts
// ✅ "@/lib/types/index" 의 "공식 타입 모음"입니다.
// - app/t/students/page.tsx, lib/storage/lectures.ts 등 현재 코드에서 실제로 사용하는 필드에 맞춰 작성했습니다.

// ===== 공통 ID =====
export type Id = string;


// ===== 선생님(Teacher) =====
// - A안: Student.teacherId 로 배정/필터링합니다.
export type Teacher = {
  id: Id;          // 고유 ID (내부 식별자)
  token: string;   // 링크/공유용 토큰 (id와 별도 운영 가능)

  name: string;
  phone?: string;
  email?: string;
  workStartDate?: string; // "YYYY-MM-DD"
  createdAt?: string; // ISO string
  active?: boolean;
};

// ===== 학생(Student) =====
export type StudentStatus = "active" | "paused" | "ended";

export type Student = {
  id: Id;
  token: string;

  name: string;
  cohort: string; // 예: 2025_123456
  status: StudentStatus;

  // 자동 회차 생성에 필요한 값들
  startDate: string; // "YYYY-MM-DD"
  planCount: number; // 1..60
  scheduleRules: ScheduleRule[];

  // A안: 원장이 배정한 담당 선생님 (미배정이면 null)
  teacherId?: string | null;

  // ---------- 신규 학생 기본정보(필수) ----------
  // Google e-mail은 UI에서 전체 주소(예: xx@yy.zz)로 입력받아 저장합니다.
  googleEmail: string;

  // 전화번호는 저장 시 숫자만 남깁니다(예: 010-1234-5678 -> 01012345678)
  studentPhone: string;
  parentPhone: string;

  school: string;
  grade: string; // 예: "1".."12","N수"

  // ---------- 선택 ----------
  gender?: "male" | "female";
  parentRole?: "father" | "mother";

  createdAt?: string; // ISO string

  // 추가 결제 기록(환불 산정용)
  paymentHistory?: PaymentRecord[];

  // 수업 시간 변경 기록(지정 회차부터 적용)
  scheduleChangeEvents?: ScheduleChangeEvent[];

  // 기본 수업 환불(기본 카드용)
  baseRefundStatus?: "requested" | "completed";
  baseRefundSessionIndex?: number;
  baseRefundRatio?: "full" | "two_thirds" | "half" | "none";
  baseRefundReason?: string;
  baseRefundRequestedAt?: string; // ISO string
  baseRefundProcessedAt?: string; // ISO string
  baseRefundProcessedDate?: string; // "YYYY-MM-DD"
  baseRefundConsultNote?: string;

  // 상담 기록
  consultationHistory?: ConsultationRecord[];
  pauseEffectiveDate?: string;
  pauseStatus?: "confirmed" | "paused" | "none";
};

export type ConsultationRecord = {
  id: Id;
  date: string; // "YYYY-MM-DD"
  purpose: "general" | "pause_request" | "extension";
  target: "student" | "parent";
  content: string;
  adminConsultDate?: string; // "YYYY-MM-DD"
  extensionResult?: "extended" | "not_extended";
  extensionPaymentDate?: string; // "YYYY-MM-DD"
  extensionAddedCount?: number;
  extensionPaymentConfirmed?: boolean;
  extensionAppliedAt?: string; // ISO string
  extensionPaymentRecordId?: string;
  finalNote?: string;
  finalResult?: "pause_cancel" | "pause_confirm";
  pauseEffectiveDate?: string;
  pauseRefundRatio?: "full" | "two_thirds" | "half" | "none";
  pauseRefundCompleted?: boolean;
  createdAt?: string; // ISO string
};

export type ScheduleChangeEvent = {
  id: Id;
  startIndex: number; // 이 회차부터 적용
  startDate?: string; // "YYYY-MM-DD" (선택한 변경 시작 날짜)
  newRules: ScheduleRule[];
  createdAt?: string; // ISO string
};

export type PaymentRecord = {
  id: Id;
  paymentDate: string; // "YYYY-MM-DD"
  addedCount: number;
  startIndex: number;
  endIndex: number;
  // UI 표시용 합성 레코드(기본 카드) 구분값
  isBase?: boolean;
  memo?: string;
  createdAt?: string; // ISO string

  refundStatus?: "requested" | "completed";
  refundSessionIndex?: number;
  refundRatio?: "full" | "two_thirds" | "half" | "none";
  refundReason?: string;
  refundRequestedAt?: string; // ISO string
  refundProcessedAt?: string; // ISO string
  refundProcessedDate?: string; // "YYYY-MM-DD"
  refundConsultNote?: string;
};

// ===== 스케줄 규칙(ScheduleRule) =====
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type ScheduleRule = {
  weekday: Weekday;
  hour: number;   // 0..23
  minute: number; // 0..59

  durationMin?: number;

  // (호환용) 과거 코드가 timeHHmm 를 쓰면 깨지지 않게 둡니다.
  timeHHmm?: string;
};

// ===== 회차(Session) =====
// app/t/students/page.tsx 의 상태 라벨/필터와 일치
export type SessionState = "normal" | "changed" | "carried" | "absent";

export type Session = {
  id: Id;
  studentId: Id;

  // 1-based (UI에서 1회차, 2회차…)
  index: number;

  // 표시/정렬용 예정 시각
  displayAt: string; // ISO string

  state: SessionState;

  createdAt?: string;

  // 회차 meta (선생님 편집)
  title?: string;
  memo?: string;

  // 최종 구조: 회차에 배치된 강의 leafId 목록
  lectureLeafIds?: LectureLeafId[];

  // Google Calendar/Meet 연동 메타(자동 동기화용)
  googleCalendarEventId?: string;
  googleMeetUrl?: string;
  googleCalendarOwnerEmail?: string;
  googleCalendarStatus?: "synced" | "pending" | "error";
  googleCalendarError?: string;
  googleCalendarSyncedAt?: string; // ISO string
};

// ===== 강의 트리(Lecture Tree) =====
export type LectureNodeId = string; // 노드(폴더/leaf) id
export type LectureLeafId = string; // leafId(영구, 절대 변경 금지)

// ✅ lectures.ts 에서 version / updatedAt 을 쓰므로 포함합니다.
export type LectureTree = {
  version: number;
  updatedAt: string; // ISO string
  root: LectureFolderNode;
};

export type LectureFolderNode = {
  type: "folder";
  id: LectureNodeId;

  // UI에서 바꾸는 표시 제목
  title: string;

  // lectures.ts에서 저장 시 createdAt을 넣고 있음
  createdAt?: string;

  // 폴더 정렬을 아직 안 쓰는 코드가 있어서 optional
  orderKey?: string;

  children: LectureNode[];
};

export type LectureLeafNode = {
  type: "leaf";
  id: LectureNodeId;

  title: string;

  createdAt?: string;

  // ✅ 영구, 절대 변경 금지
  leafId: LectureLeafId;

  // 정렬용(재부여 가능)
  orderKey: string;

  lectureUrl: string;
  problemUrls: string[];
};

export type LectureNode = LectureFolderNode | LectureLeafNode;

// (레거시 호환) 아직 쓰는 곳이 있으면 유지
export type SessionItem = {
  id: string;
  lectureId: string; // 과거에는 lectureId, 현재는 leafId를 담아 쓰기도 함
  noteDone: boolean;
  solveDone: boolean;
  noteLink: string;
  solveLink: string;
};
