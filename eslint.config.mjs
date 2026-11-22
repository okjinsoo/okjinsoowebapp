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
      "lib/factories/sessionScheduleResolver.ts",
      "lib/factories/format.ts",
      "lib/factories/ddayMeta.ts",
      "lib/factories/lessonStatusFactory.ts",
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
