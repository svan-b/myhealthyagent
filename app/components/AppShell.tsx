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
import { HealthDataProvider, useHealthData } from '@/lib/hooks/useHealthData';
import { useLicenseRefresh, usePro } from '@/lib/pro/client';
import { config } from '@/lib/config';
import { cn, errorMessage } from '@/lib/utils';

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

/** Finishes a Stripe Checkout redirect: exchanges the session for a license key. */
function useCheckoutReturn() {
  const { activate } = usePro();
  const done = React.useRef(false);
  React.useEffect(() => {
    if (done.current) return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get('checkout');
    if (!status) return;
    done.current = true;
    const sessionId = params.get('session_id');
    history.replaceState(null, '', window.location.pathname + window.location.hash);
    if (status === 'success' && sessionId) {
      toast.promise(activate({ sessionId }), {
        loading: 'Activating Pro…',
        success: 'Thank you. Pro is active. Your license key is saved under Reports and data.',
        error: e => errorMessage(e, 'We could not confirm the payment yet. If you were charged, contact support.'),
      });
    } else if (status === 'cancel') {
      toast('Checkout cancelled. You were not charged.');
    }
  }, [activate]);
}
