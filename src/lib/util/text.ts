/** Ékezetek nélküli, kisbetűs alak — a magyar mezőnevek illesztéséhez. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Egyszerű trigram-alapú hasonlóság 0..1 között (duplikátum-gyanúhoz). */
export function similarity(a: string, b: string): number {
  const x = trigrams(fold(a));
  const y = trigrams(fold(b));
  if (x.size === 0 || y.size === 0) return a === b ? 1 : 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared += 1;
  return (2 * shared) / (x.size + y.size);
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
