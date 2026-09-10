import Link from "next/link";

export default function ProgramsFailPage() {
  return (
    <main className="min-h-[70vh] flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 p-8 text-center">
        <div className="w-16 h-16 bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">
          ✕
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
          결제가 취소되었습니다
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-6 leading-relaxed">
          결제 과정이 중단되었거나 오류가 발생했습니다.
          <br />
          다시 시도하시거나 문의 사항이 있으시면 고객센터로 연락해 주세요.
        </p>

        <div className="space-y-2">
          <Link
            href="/programs"
            className="block w-full py-2.5 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm transition-colors"
          >
            수강 신청 페이지로 돌아가기
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
