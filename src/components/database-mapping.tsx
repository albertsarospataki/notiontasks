'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { MappedDatabase } from '@/lib/mapping/store';
import { FIELD_LABELS, ROLE_LABELS, ROLES, ROLE_FIELDS, type CanonicalField, type Role } from '@/lib/mapping/roles';
import { Badge, NotionLink, type Tone } from './ui';

/**
 * Adatbázis-szerkesztő.
 *
 * Itt lehet felülbírálni, amit a cockpit magától kitalált: az adatbázis
 * szerepét és azt, hogy melyik Notion-property felel meg melyik kanonikus
 * mezőnek. A szerep megváltoztatása újra megkeresi a mezőket az új szerephez.
 */
export function DatabaseMapping({ databases }: { databases: MappedDatabase[] }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <ul className="space-y-2">
      {databases.map((d) => (
        <DatabaseRow
          key={d.id}
          database={d}
          expanded={open === d.id}
          onToggle={() => setOpen(open === d.id ? null : d.id)}
        />
      ))}
    </ul>
  );
}

function confidenceTone(d: MappedDatabase): Tone {
  if (d.roleSource === 'manual' || d.reviewed) return 'good';
  if (d.confidence >= 0.75) return 'accent';
  if (d.confidence >= 0.5) return 'warn';
  return 'danger';
}

function DatabaseRow({ database, expanded, onToggle }: {
  database: MappedDatabase;
  expanded: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const [role, setRole] = useState<Role>(database.role);
  const [fields, setFields] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(database.fields).map(([k, v]) => [k, v ?? ''])),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const propertyOptions = Object.entries(database.schema)
    .map(([name, p]) => ({ name, type: p.type ?? 'ismeretlen' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'hu'));

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/databases/${database.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; database?: MappedDatabase };
      if (!res.ok || !data.ok) {
        setMessage(data.error ?? 'Nem sikerült menteni.');
      } else {
        setMessage('Mentve.');
        if (data.database) {
          setRole(data.database.role);
          setFields(Object.fromEntries(Object.entries(data.database.fields).map(([k, v]) => [k, v ?? ''])));
        }
        startTransition(() => router.refresh());
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Hálózati hiba.');
    } finally {
      setSaving(false);
    }
  };

  const changeRole = async (next: Role) => {
    setRole(next);
    await save({ role: next, reviewed: true });
  };

  const changeField = async (field: CanonicalField, value: string) => {
    setFields((prev) => ({ ...prev, [field]: value }));
    await save({ fields: { [field]: value }, reviewed: true });
  };

  const relevantFields = ROLE_FIELDS[role] ?? [];

  return (
    <li className="surface rounded-lg">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button type="button" onClick={onToggle} className="soft w-4 text-xs" aria-label={expanded ? 'Bezár' : 'Kinyit'}>
          {expanded ? '▾' : '▸'}
        </button>

        <NotionLink url={database.url} className="text-sm font-medium">
          {database.icon && !database.icon.startsWith('http') && <span className="mr-1">{database.icon}</span>}
          {database.title}
        </NotionLink>

        <Badge tone={confidenceTone(database)} title={database.reason}>
          {ROLE_LABELS[database.role]}
          {database.roleSource === 'auto' && ` · ${Math.round(database.confidence * 100)}%`}
        </Badge>

        {database.roleSource === 'manual' && <Badge tone="good">kézi</Badge>}
        {!database.includeInDashboard && <Badge>kihagyva</Badge>}
        {database.removed && <Badge tone="danger">már nem elérhető</Badge>}

        <span className="soft ml-auto text-[11px]">
          {Object.keys(database.schema).length} mező
        </span>
      </div>

      {expanded && (
        <div className="border-t px-3 py-3" style={{ borderColor: 'var(--border)' }}>
          <p className="soft mb-3 text-xs">{database.reason || 'Nincs indoklás.'}</p>

          <label className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium">Szerep:</span>
            <select
              value={role}
              onChange={(e) => void changeRole(e.target.value as Role)}
              disabled={saving}
              className="rounded border px-2 py-1 text-xs"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void save({ includeInDashboard: !database.includeInDashboard, reviewed: true })}
              disabled={saving}
              className="rounded px-2 py-1 disabled:opacity-50"
              style={{ background: 'var(--color-muted-soft)', color: 'var(--text-soft)' }}
            >
              {database.includeInDashboard ? 'Kihagyás a nézetekből' : 'Visszavétel a nézetekbe'}
            </button>
            {message && <span className="soft">{message}</span>}
          </label>

          {relevantFields.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-medium">Mezőleképezés</p>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {relevantFields.map((field) => (
                  <label key={field} className="flex flex-col gap-0.5 text-xs">
                    <span className="soft">{FIELD_LABELS[field]}</span>
                    <select
                      value={fields[field] ?? ''}
                      onChange={(e) => void changeField(field, e.target.value)}
                      disabled={saving}
                      className="rounded border px-2 py-1 text-xs"
                      style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}
                    >
                      <option value="">— nincs —</option>
                      {propertyOptions.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name} ({p.type})
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <p className="soft mt-2 text-[11px]">
                A „— nincs —" azt jelenti, hogy ez a mező szándékosan üresen marad. Az automatikus találgatás
                visszaállításához válaszd újra a szerepet.
              </p>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
