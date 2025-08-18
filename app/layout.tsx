import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { Toaster } from 'sonner';
import ServiceWorkerProvider from './components/ServiceWorkerProvider';
import { OfflineIndicator } from './components/OfflineIndicator';
import './styles/mobile.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'myHealthyAgent',
  description: 'Track symptoms in 7 seconds',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>
          <ServiceWorkerProvider />
          <OfflineIndicator />
          {children}
          <Toaster position="top-center" />
        </Providers>
      </body>
    </html>
  );
}
