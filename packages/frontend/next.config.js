/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Disable image optimisation for static-export-friendly Cloudflare Pages builds.
  images: { unoptimized: true },
  // Surface env vars used by client components. Only NEXT_PUBLIC_* values
  // are exposed to the browser; server components receive process.env directly.
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
};

module.exports = nextConfig;
