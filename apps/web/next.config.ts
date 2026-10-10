import type { NextConfig } from "next";

// Üretimde Traefik /api yolunu doğrudan API'ye yönlendirir; bu yeniden yazma yerel geliştirme
// ve yönlendirmenin atlandığı durumlar içindir.
const api = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3001";

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
  transpilePackages: ["@retfast/core"],
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${api}/:path*` }];
  },
};

export default config;
