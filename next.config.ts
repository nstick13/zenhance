import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the Turbopack workspace root to this repo. Without it, Next walks up
  // looking for lockfiles, finds a stray one in the home directory, and infers
  // ~ as a monorepo root — which balloons the file-watching scope and puts
  // ~/node_modules above ours in resolution. See the `root` section of
  // node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/turbopack.md
  turbopack: { root: __dirname },
};

export default nextConfig;
