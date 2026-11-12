import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import ServiceWorkerProvider from './components/ServiceWorkerProvider';
import { OfflineIndicator } from './components/OfflineIndicator';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

const description =
  'A private symptom diary that finds delayed triggers. Log symptoms, food and activities in seconds, then see what lines up. No account, data stays on your device.';

export const metadata: Metadata = {
  title: { default: 'myHealthyAgent · Private symptom and trigger tracker', template: '%s · myHealthyAgent' },
  description,
  applicationName: 'myHealthyAgent',
  metadataBase: process.env.NEXT_PUBLIC_APP_URL ? new URL(process.env.NEXT_PUBLIC_APP_URL) : undefined,
  appleWebApp: { capable: true, title: 'myHealthyAgent', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  openGraph: {
    title: 'myHealthyAgent',
    description,
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'myHealthyAgent finds delayed symptom triggers' }],
  },
  twitter: { card: 'summary_large_image', title: 'myHealthyAgent', description, images: ['/og.png'] },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1218' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body>
        <Providers>
          <ServiceWorkerProvider />
          <OfflineIndicator />
          {children}
        </Providers>
      </body>
    </html>
  );
}
