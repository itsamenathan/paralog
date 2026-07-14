import type { NextConfig } from "next";

const nextConfig: NextConfig = { output: "standalone", serverExternalPackages: ["better-sqlite3", "web-push"] };
export default nextConfig;
