import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Cache Components (Next.js 16's default) is deliberately OFF here: this
   * whole app is authenticated, per-request business data (orders,
   * inventory, insights) with no public/anonymous content to benefit
   * from partial static prerendering. Turning it on would mean wrapping
   * every page's data fetch in a Suspense boundary for zero real gain --
   * not worth the added complexity for a single-cafe internal tool. */
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
