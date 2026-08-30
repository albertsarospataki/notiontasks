import { isConfigured } from '@/lib/env';
import { getOrganizations } from '@/lib/view/organizations';
import { listMappedDatabases } from '@/lib/mapping/store';
import { OwnerToggle } from '@/components/owner-toggle';
import { SetupNotice } from '@/components/setup-notice';
import { Badge, Empty, NotionLink, SectionTitle, Stat } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ owner?: string }>;
}) {
  const params = await searchParams;
  const ownerOnly = params.owner === '1';

  const hasOrgDb = listMappedDatabases().some((d) => d.role === 'organization');
  if (!isConfigured()) return <SetupNotice configured={false} hasDatabases={false} />;
  if (!hasOrgDb) {
    return (
      <Empty>
        Nem találtunk szervezet-adatbázist. Az <strong>Adatbázisok</strong> fülön állítható be, melyik adatbázis
        tartalmazza a cégeket.
      </Empty>
    );
  }

  const orgs = getOrganizations(ownerOnly);
  const withWork = orgs.filter((o) => o.taskStats.open > 0 || o.projects.length > 0);
  const idle = orgs.filter((o) => !withWork.includes(o));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Szervezetek és cégek</h1>
          <p className="soft text-xs">{orgs.length} szervezet · {withWork.length} aktív</p>
        </div>
        <OwnerToggle />
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Szervezet" value={orgs.length} />
        <Stat label="Aktív" value={withWork.length} tone="accent" />
        <Stat
          label="Lejárt feladat"
          value={orgs.reduce((n, o) => n + o.taskStats.overdue, 0)}
          tone={orgs.some((o) => o.taskStats.overdue > 0) ? 'danger' : 'good'}
        />
        <Stat label="Nyitott feladat" value={orgs.reduce((n, o) => n + o.taskStats.open, 0)} />
      </section>

      <section>
        <SectionTitle count={withWork.length}>Aktív szervezetek</SectionTitle>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {withWork.map((o) => (
            <article key={o.id} className="surface rounded-lg p-3">
              <div className="flex items-start justify-between gap-2">
                <NotionLink url={o.url} className="text-sm font-semibold">
                  {o.icon && !o.icon.startsWith('http') && <span className="mr-1">{o.icon}</span>}
                  {o.title}
                </NotionLink>
                {o.category && <Badge>{o.category}</Badge>}
              </div>

              {o.description && <p className="soft mt-1 line-clamp-2 text-xs">{o.description}</p>}

              <div className="soft tabular mt-2 flex flex-wrap gap-x-3 text-[11px]">
                <span>{o.taskStats.open} nyitott feladat</span>
                {o.taskStats.overdue > 0 && (
                  <span style={{ color: 'var(--color-danger)' }}>{o.taskStats.overdue} lejárt</span>
                )}
                <span>{o.projects.length} projekt</span>
                <span>{o.people.length} kapcsolat</span>
              </div>

              {o.projects.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1">
                  {o.projects.slice(0, 6).map((p) => (
                    <li key={p.id}>
                      <NotionLink url={p.url}>
                        <Badge tone="accent">{p.title}</Badge>
                      </NotionLink>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      </section>

      {idle.length > 0 && (
        <section>
          <SectionTitle count={idle.length} hint="nincs hozzájuk kötött aktív munka">
            Nyugvó szervezetek
          </SectionTitle>
          <ul className="flex flex-wrap gap-1.5">
            {idle.map((o) => (
              <li key={o.id}>
                <NotionLink url={o.url}>
                  <Badge>{o.title}</Badge>
                </NotionLink>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
