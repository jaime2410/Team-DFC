/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['sql.js', 'pdf-parse'],
  },
};

export default nextConfig;
