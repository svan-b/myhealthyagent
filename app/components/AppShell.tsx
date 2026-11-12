'use client';

import * as React from 'react';
import { PenLine, History, LineChart, Pill, Menu } from 'lucide-react';
import { toast } from 'sonner';
import { LogScreen } from './log/LogScreen';
import { HistoryScreen } from './history/HistoryScreen';
import { InsightsScreen } from './insights/InsightsScreen';
import { MedsScreen } from './meds/MedsScreen';
import { SettingsSheet } from './settings/SettingsSheet';
import { Onboarding } from './Onboarding';
import { InstallPrompt } from './InstallPrompt';
import { announceActivating, announceActivation, supportText } from './pro/activation';
import { HealthDataProvider, useHealthData } from '@/lib/hooks/useHealthData';
import {
  CHECKOUT_SESSION_ID,
  finishCheckout,
  savePendingCheckout,
  useLicenseRefresh,
  usePendingCheckoutRetry,
} from '@/lib/pro/client';
import { config } from '@/lib/config';
import { cn } from '@/lib/utils';

const TABS = [
  { id: 'log', label: 'Log', icon: PenLine },
  { id: 'history', label: 'History', icon: History },
  { id: 'insights', label: 'Insights', icon: LineChart },
  { id: 'meds', label: 'Meds', icon: Pill },
] as const;
type TabId = (typeof TABS)[number]['id'];

const isTab = (v: string): v is TabId => TABS.some(t => t.id === v);

export function AppShell() {
  return (
    <HealthDataProvider>
      <Shell />
    </HealthDataProvider>
  );
}

function Shell() {
  const { prefs, loading, error, symptoms, factors } = useHealthData();
  // People upgrading from an earlier version have data but no onboarding flag. Do not send them back through it.
  const onboarding = !loading && !prefs.onboardedAt && symptoms.length + factors.length === 0;
  const [tab, setTab] = React.useState<TabId>('log');
  const [menuOpen, setMenuOpen] = React.useState(false);
  useLicenseRefresh();
  useCheckoutReturn();

  // Keep the tab in the URL hash so back and refresh behave.
  React.useEffect(() => {
    const read = () => {
      const h = window.location.hash.slice(1);
      if (isTab(h)) setTab(h);
      else if (h === 'settings') setMenuOpen(true);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  const go = (id: TabId) => {
    setTab(id);
    if (window.location.hash !== `#${id}`)
      history.replaceState(null, '', id === 'log' ? window.location.pathname : `#${id}`);
    window.scrollTo({ top: 0 });
  };

  if (error) {
    return (
      <main className="max-w-lg mx-auto px-4 py-16 text-center">
        <h1 className="text-xl font-bold text-fg">Storage is unavailable</h1>
        <p className="text-muted mt-2">{error}</p>
        <p className="text-muted mt-2">
          This app keeps your data in your browser. Private or incognito windows, and some strict privacy settings,
          block that. Try a normal window.
        </p>
      </main>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-30 bg-bg/90 backdrop-blur border-b border-line safe-top">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center justify-between">
          <span className="flex items-center gap-2 font-bold text-fg">
            <img src="/icon.svg" alt="" width={24} height={24} className="rounded-md" />
            {config.appName}
          </span>
          {!onboarding && (
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="flex items-center gap-2 h-10 px-3 -mr-2 rounded-xl text-sm font-semibold text-muted hover:text-fg hover:bg-surface-2"
            >
              <Menu className="size-5" aria-hidden />
              Reports and data
            </button>
          )}
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 pt-5 pb-nav">
        {onboarding ? (
          <Onboarding />
        ) : (
          <>
            {tab === 'log' && <LogScreen />}
            {tab === 'history' && <HistoryScreen />}
            {tab === 'insights' && <InsightsScreen />}
            {tab === 'meds' && <MedsScreen />}
            <InstallPrompt />
          </>
        )}
      </main>

      {!onboarding && (
        <nav
          className="fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur border-t border-line safe-bottom"
          aria-label="Main"
        >
          <div className="max-w-xl mx-auto grid grid-cols-4">
            {TABS.map(t => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => go(t.id)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'h-16 flex flex-col items-center justify-center gap-1 text-[12px] font-semibold',
                    active ? 'text-accent' : 'text-subtle hover:text-fg',
                  )}
                >
                  <Icon className="size-[22px]" aria-hidden strokeWidth={active ? 2.4 : 2} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </nav>
      )}

      <SettingsSheet
        open={menuOpen}
        onOpenChange={o => {
          setMenuOpen(o);
          if (!o && window.location.hash === '#settings') history.replaceState(null, '', window.location.pathname);
        }}
      />
    </>
  );
}

/**
 * Finishes a Stripe Checkout redirect. The session id is saved on the device before the address is
 * cleaned, and the exchange for a license key is retried until it works or gets a final answer.
 */
function useCheckoutReturn() {
  const done = React.useRef(false);
  React.useEffect(() => {
    // Wait until every effect of the first render has run. By then the toaster is listening, and Next's
    // router has taken over history, so cleaning the address keeps Back working. The done check sits
    // inside the timer so React's development double run cannot cancel the only attempt.
    const timer = window.setTimeout(() => {
      if (done.current) return;
      const params = new URLSearchParams(window.location.search);
      const status = params.get('checkout');
      if (!status) return;
      done.current = true;
      const sessionId = params.get('session_id');
      const cleanUrl = () => history.replaceState(null, '', window.location.pathname + window.location.hash);
      if (status === 'success' && sessionId) {
        void returnFromCheckout(sessionId, cleanUrl);
      } else {
        cleanUrl();
        if (status === 'cancel') toast('Checkout cancelled. You were not charged.');
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  usePendingCheckoutRetry(announceActivation);
}

async function returnFromCheckout(sessionId: string, cleanUrl: () => void) {
  if (!CHECKOUT_SESSION_ID.test(sessionId)) {
    cleanUrl();
    toast.error('That checkout link is not complete, so Pro could not be turned on.', {
      description: supportText(sessionId),
      duration: Infinity,
    });
    return;
  }
  try {
    await savePendingCheckout(sessionId);
  } catch {
    // Nothing could be saved. Keep the address as it is, so reloading the page tries again.
    toast.error('Could not save your purchase on this device.', {
      description: supportText(sessionId),
      duration: Infinity,
    });
    return;
  }
  cleanUrl();
  announceActivating(sessionId);
  announceActivation(await finishCheckout(sessionId), sessionId, { showPending: true });
}
