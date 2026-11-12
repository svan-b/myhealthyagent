import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="max-w-lg mx-auto px-4 py-16 text-center">
      <h1 className="text-xl font-bold text-fg">Page not found</h1>
      <Link
        href="/"
        className="inline-block mt-6 h-11 leading-[2.75rem] px-4 rounded-xl bg-accent text-on-accent font-semibold"
      >
        Open the app
      </Link>
    </main>
  );
}
