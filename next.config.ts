import type { NextConfig } from "next"

// Where the Next.js server proxies /api/v1/* (same-origin for the browser, so the refresh cookie works).
// Read at build time and baked into the standalone server: pass it as a build arg in Docker.
const backendUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
]

const nextConfig: NextConfig = {
  // Minimal self-contained server (node server.js) for the production image.
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }]
  },
  async rewrites() {
    return [
      { source: "/api/v1/:path*", destination: `${backendUrl}/api/v1/:path*` },
      { source: "/health", destination: `${backendUrl}/health` },
      { source: "/health/:path*", destination: `${backendUrl}/health/:path*` },
    ]
  },
}

export default nextConfig
