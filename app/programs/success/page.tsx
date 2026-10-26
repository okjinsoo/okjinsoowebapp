import { Suspense } from "react";
import ProgramsSuccessClient from "@/lib/ui/programs/ProgramsSuccessClient";

export default function ProgramsSuccessPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-[70vh] flex items-center justify-center py-12 px-4">
          <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 p-8 text-center">
            <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">
              결제 처리 중...
            </h1>
          </div>
        </main>
      }
    >
      <ProgramsSuccessClient />
    </Suspense>
  );
}
