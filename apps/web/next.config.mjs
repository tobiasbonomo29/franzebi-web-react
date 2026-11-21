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
