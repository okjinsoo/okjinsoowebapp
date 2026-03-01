import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSentryConfig(nextConfig, {
  silent: true,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
  // 초보 운영 환경에서는 먼저 런타임 오류 수집만 켭니다.
  // 소스맵 업로드는 SENTRY_AUTH_TOKEN 준비 후 활성화하면 됩니다.
  sourcemaps: {
    disable: true,
  },
});
