/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // URLs idénticas a WooCommerce (/product/<slug>/, /product-category/<path>/) => sin 301 masivos.
  trailingSlash: true,
  transpilePackages: ["@franzebi/domain", "@franzebi/sync"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" }],
  },
  // Fotos de producto heredadas (/wp-content/uploads/...): si no están en public/, se piden al origen legacy
  // (LEGACY_MEDIA_ORIGIN, p.ej. https://franzebi.ar mientras WP siga online). Antes del cutover se migran a Storage
  // y esta variable apunta al bucket (ver docs/04-plan-migracion.md).
  async rewrites() {
    const origin = process.env.LEGACY_MEDIA_ORIGIN?.replace(/\/$/, "");
    return { beforeFiles: [], afterFiles: [], fallback: origin ? [{ source: "/wp-content/uploads/:path*", destination: `${origin}/wp-content/uploads/:path*` }] : [] };
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  webpack(config) {
    // Los paquetes internos usan imports ESM con sufijo .js sobre fuentes .ts
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};

export default nextConfig;
