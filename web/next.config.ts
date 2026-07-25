import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: __dirname },
  async rewrites() {
    return [
      { source: "/docs/cli/:command.md", destination: "/api/cli-md/:command" },
      { source: "/docs/:slug.md", destination: "/api/docs-md/:slug" },
      {
        source: "/presentation/:path*",
        destination: "https://pulkitxm.github.io/warden/presentation/:path*",
      },
      { source: "/demo/:path*", destination: "https://pulkitxm.github.io/warden/demo/:path*" },
    ];
  },
};

export default nextConfig;
