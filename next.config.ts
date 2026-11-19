const nextConfig = {
  output: "export",
  images: { unoptimized: true },
  devIndicators: false,
  turbopack: {
    root: process.cwd(),
  },
};
export default nextConfig;