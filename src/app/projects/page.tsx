import { isConfigured } from '@/lib/env';
import { getPortfolio } from '@/lib/view/projects';
import { listMappedDatabases } from '@/lib/mapping/store';
import { ProjectCard } from '@/components/project-card';
import { OwnerToggle } from '@/components/owner-toggle';
import { SetupNotice } from '@/components/setup-notice';
import { Empty, SectionTitle, Stat } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ owner?: string }>;
}) {
  const params = await searchParams;
  const ownerOnly = params.owner === '1';

  const hasProjectDb = listMappedDatabases().some((d) => d.role === 'project');
  if (!isConfigured() || !hasProjectDb) {
    return (
      <div className="space-y-4">
        <SetupNotice configured={isConfigured()} hasDatabases={hasProjectDb} />
        {isConfigured() && !hasProjectDb && (
          <Empty>
            Nem találtunk projekt-adatbázist. Ha van ilyen a workspace-ben, az <strong>Adatbázisok</strong> fülön
            állítsd a szerepét „Projektek"-re.
          </Empty>
        )}
      </div>
    );
  }

  const portfolio = getPortfolio(ownerOnly);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Projekt-portfólió</h1>
          <p className="soft text-xs">
            {portfolio.stats.total} projekt · {portfolio.projects.reduce((n, p) => n + p.subprojects.length, 0)} alprojekt
          </p>
        </div>
        <OwnerToggle />
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Összes projekt" value={portfolio.stats.total} />
        <Stat label="Végrehajtás alatt" value={portfolio.stats.active} tone="accent" />
        <Stat label="Blokkolt" value={portfolio.stats.blocked} tone={portfolio.stats.blocked ? 'warn' : 'neutral'} />
        <Stat label="Veszélyben" value={portfolio.stats.atRisk} tone={portfolio.stats.atRisk ? 'danger' : 'good'} />
        <Stat
          label="Feladat nélkül"
          value={portfolio.stats.withoutOpenTasks}
          hint="futó projekt, nyitott feladat nélkül"
        />
      </section>

      {portfolio.byArea.map(({ area, projects }) => (
        <section key={area}>
          <SectionTitle count={projects.length}>{area}</SectionTitle>
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        </section>
      ))}

      {portfolio.orphanSubprojects.length > 0 && (
        <section>
          <SectionTitle count={portfolio.orphanSubprojects.length} hint="nincs projekthez kötve">
            Gazdátlan alprojektek
          </SectionTitle>
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {portfolio.orphanSubprojects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
