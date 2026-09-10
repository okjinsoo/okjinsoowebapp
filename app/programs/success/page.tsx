import Link from "next/link";

export default function ProgramsSuccessPage() {
  return (
    <main className="min-h-[70vh] flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 p-8 text-center">
        <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">
          ✓
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
          수강 신청 및 결제 완료
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-6 leading-relaxed">
          수강 신청 및 결제가 정상적으로 처리되었습니다.
          <br />
          수업 일정 및 Google Meet 안내는 기재해주신 연락처로 전송됩니다.
        </p>

        <div className="space-y-2">
          <Link
            href="/programs"
            className="block w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm transition-colors"
          >
            수업 안내로 돌아가기
          </Link>
          <Link
            href="/"
            className="block w-full py-2 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-sm hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
          >
            홈으로 이동
          </Link>
        </div>
      </div>
    </main>
  );
}
