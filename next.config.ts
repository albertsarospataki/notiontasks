import type { NextConfig } from 'next';

const config: NextConfig = {
  // Önálló szerver-csomag: a konténerbe csak a ténylegesen használt fájlok kerülnek.
  output: 'standalone',
  // A better-sqlite3 natív modul — a szerver-bundle-ből ki kell hagyni.
  serverExternalPackages: ['better-sqlite3'],
  // A cockpit belső eszköz; a keresők ne indexeljék, ha véletlenül elérhető lenne.
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }];
  },
};

export default config;
