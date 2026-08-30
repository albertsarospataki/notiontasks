import type { NextConfig } from 'next';

const config: NextConfig = {
  // A better-sqlite3 natív modul — a szerver-bundle-ből ki kell hagyni.
  serverExternalPackages: ['better-sqlite3'],
};

export default config;
