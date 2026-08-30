import type { ReactNode } from 'react';

/** Közös, apró megjelenítő elemek — hogy a nézetek egységesek maradjanak. */

export type Tone = 'neutral' | 'accent' | 'danger' | 'warn' | 'good';

const TONE_STYLE: Record<Tone, { background: string; color: string }> = {
  neutral: { background: 'var(--color-muted-soft)', color: 'var(--text-soft)' },
  accent: { background: 'var(--color-accent-soft)', color: 'var(--color-accent)' },
  danger: { background: 'var(--color-danger-soft)', color: 'var(--color-danger)' },
  warn: { background: 'var(--color-warn-soft)', color: 'var(--color-warn)' },
  good: { background: 'var(--color-good-soft)', color: 'var(--color-good)' },
};

export function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: Tone; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={TONE_STYLE[tone]}
    >
      {children}
    </span>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`surface rounded-lg ${className}`}>{children}</div>;
}

export function SectionTitle({ children, count, hint }: { children: ReactNode; count?: number; hint?: string }) {
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <h2 className="text-sm font-semibold tracking-tight">{children}</h2>
      {count !== undefined && <span className="soft tabular text-xs">{count}</span>}
      {hint && <span className="soft text-xs">· {hint}</span>}
    </div>
  );
}

export function Stat({ label, value, tone = 'neutral', hint }: { label: string; value: ReactNode; tone?: Tone; hint?: string }) {
  return (
    <div className="surface rounded-lg px-3 py-2.5">
      <div className="soft text-[11px] uppercase tracking-wide">{label}</div>
      <div className="tabular mt-0.5 text-xl font-semibold" style={{ color: tone === 'neutral' ? undefined : TONE_STYLE[tone].color }}>
        {value}
      </div>
      {hint && <div className="soft mt-0.5 text-[11px]">{hint}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-lg border border-dashed px-4 py-6 text-center text-sm"
      style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}
    >
      {children}
    </div>
  );
}

/** Külső Notion-hivatkozás — a felületről mindig egy kattintás a forrás. */
export function NotionLink({ url, children, className = '' }: { url: string | null; children: ReactNode; className?: string }) {
  if (!url) return <span className={className}>{children}</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className={`hover:underline ${className}`}>
      {children}
    </a>
  );
}
