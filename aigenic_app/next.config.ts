import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: {
    // The pnpm workspace root, not aigenic_app: pnpm hoists the real package
    // files into <repo>/node_modules/.pnpm, and Turbopack refuses to resolve
    // anything outside its root — so pointing this at aigenic_app makes every
    // dependency unresolvable.
    root: path.resolve(__dirname, '..'),
  },
};

export default nextConfig;
