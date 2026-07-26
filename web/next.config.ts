import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: __dirname },
  async redirects() {
    return [{ source: "/install", destination: "/docs/install", permanent: true }];
  },
  async headers() {
    return [
      {
        source: "/install.sh",
        headers: [{ key: "Content-Type", value: "text/plain; charset=utf-8" }],
      },
    ];
  },
  async rewrites() {
    return [
      { source: "/docs/cli/:command.md", destination: "/api/cli-md/:command" },
      { source: "/docs/:slug.md", destination: "/api/docs-md/:slug" },
    ];
  },
};

export default nextConfig;
