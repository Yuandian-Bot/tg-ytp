import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["telegram"],
  poweredByHeader: false,
};

export default nextConfig;
