import type { NextConfig } from "next";

const allowedDevOrigins = process.env.PARALOG_ALLOWED_DEV_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "web-push"],
  outputFileTracingIncludes: {
    "/*": ["./drizzle/**/*"],
  },
  allowedDevOrigins,
};

export default nextConfig;
