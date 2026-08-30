import { Suspense } from 'react';
import { LoginForm } from '@/components/login-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Belépés — Notion Cockpit' };

export default function LoginPage() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-4">
      <div className="surface rounded-lg p-6">
        <h1 className="text-base font-semibold tracking-tight">Notion Cockpit</h1>
        <p className="soft mt-1 mb-5 text-xs">
          Ez a felület a teljes Notion-workspace tartalmát mutatja, ezért jelszóval védett.
        </p>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
