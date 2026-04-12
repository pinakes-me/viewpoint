/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "kfryoxrdhptoghqowvqd.supabase.co",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "image.aladin.co.kr",
      },
      {
        protocol: "https",
        hostname: "flexible.img.hani.co.kr",
      },
    ],
  },
};

export default nextConfig;
