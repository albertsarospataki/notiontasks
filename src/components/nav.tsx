'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'Ma' },
  { href: '/week', label: 'Hét' },
  { href: '/month', label: 'Hónap' },
  { href: '/projects', label: 'Projektek' },
  { href: '/organizations', label: 'Szervezetek' },
  { href: '/suggestions', label: 'Javaslatok' },
  { href: '/databases', label: 'Adatbázisok' },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="scroll-x -mx-1">
      <ul className="flex items-center gap-1 px-1">
        {ITEMS.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className="block rounded px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors"
                style={
                  active
                    ? { background: 'var(--color-accent-soft)', color: 'var(--color-accent)', fontWeight: 600 }
                    : { color: 'var(--text-soft)' }
                }
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
