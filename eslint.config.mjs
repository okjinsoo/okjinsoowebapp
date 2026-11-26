import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [
      "lib/factories/**/*.{ts,tsx}",
      "lib/server/**/*.{ts,tsx}",
      "lib/integrations/**/*.{ts,tsx}",
      "lib/hooks/**/*.{ts,tsx}",
      "lib/shared/**/*.{ts,tsx}",
    ],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/ui/*", "@/lib/ui/**"],
              message: "비-UI 계층에서는 lib/ui를 직접 참조할 수 없습니다.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "lib/server/**/*.{ts,tsx}",
      "lib/shared/**/*.{ts,tsx}",
      "lib/factories/sessionFactories.ts",
      "lib/factories/sessionEffectiveCore.ts",
      "lib/factories/sessionDisplaySync.ts",
      "lib/factories/sessionScheduleResolver.ts",
      "lib/factories/format.ts",
      "lib/factories/ddayMeta.ts",
      "lib/factories/lessonStatusFactory.ts",
      "lib/integrations/googleCalendarCore.ts",
    ],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/ui/*", "@/lib/ui/**"],
              message: "순수/서버 계층에서는 lib/ui를 직접 참조할 수 없습니다.",
            },
            {
              group: ["@/lib/storage/*", "@/lib/storage/**"],
              message: "순수/서버 계층에서는 브라우저 저장소(lib/storage)를 직접 참조할 수 없습니다.",
            },
          ],
        },
      ],
    },
  },
  {
    // 저장소 계층은 "적기만" 합니다. 구글 캘린더/드라이브 같은 외부 연동을 직접 부르면 안 됩니다.
    // 연동이 필요하면 lib/integrations 쪽 함수(예: saveSessionsAndSyncCalendar)를 화면에서 부르세요.
    files: ["lib/storage/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/ui/*", "@/lib/ui/**"],
              message: "저장소 계층(lib/storage)에서는 lib/ui를 직접 참조할 수 없습니다.",
            },
            {
              group: ["@/lib/integrations/*", "@/lib/integrations/**"],
              message:
                "저장소 계층(lib/storage)에서는 외부 연동(lib/integrations)을 직접 부를 수 없습니다. 연동은 lib/integrations 쪽 래퍼 함수를 사용하세요.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
