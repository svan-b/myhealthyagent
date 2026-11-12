import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <main className="max-w-2xl mx-auto px-4 py-8 safe-top">
      <Link href="/" className="inline-flex items-center gap-1 text-sm font-semibold text-accent">
        <ChevronLeft className="size-4" aria-hidden /> Back to the app
      </Link>
      <h1 className="text-3xl font-bold text-fg mt-6">{title}</h1>
      <p className="text-sm text-subtle mt-1">Last updated {updated}</p>
      <div className="mt-8 space-y-5 text-[16px] leading-relaxed text-fg [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-10 [&_p]:text-muted [&_li]:text-muted [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_a]:text-accent [&_a]:underline">
        {children}
      </div>
    </main>
  );
}
