'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { FileText, Download, Upload, Table, Trash2, Mail, ShieldCheck, Sparkles } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/chip';
import { Input, Label } from '@/components/ui/field';
import { Card } from '@/components/ui/card';
import { useHealthData } from '@/lib/hooks/useHealthData';
import { db } from '@/lib/db/client';
import { downloadFile, exportBackup, exportCSV, importBackup } from '@/lib/db/backup';
import { usePro } from '@/lib/pro/client';
import { config } from '@/lib/config';
import { describeRestore, errorMessage } from '@/lib/utils';
import { reportErrorMessage, UNPRINTED_CHARACTERS } from '@/lib/report/messages';
import { LicenseKeyForm, ManageBilling, UpgradeCard } from '../pro/Upgrade';

const stamp = () => new Date().toISOString().slice(0, 10);

export function SettingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Reports and data"
      description="Everything here runs on your device."
    >
      <div className="space-y-7">
        <ReportSection />
        <BackupSection />
        <ProSection />
        <AppearanceSection />
        <AboutSection />
        <DeleteSection onDone={() => onOpenChange(false)} />
      </div>
    </Sheet>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-subtle mb-2">{title}</h3>
      {children}
    </section>
  );
}

export function ReportSection() {
  const data = useHealthData();
  const { isPro, enabled } = usePro();
  const [days, setDays] = React.useState<'30' | '90'>('30');
  const [name, setName] = React.useState(data.prefs.reportName ?? '');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => setName(data.prefs.reportName ?? ''), [data.prefs.reportName]);

  const generate = async () => {
    setBusy(true);
    try {
      if (name !== (data.prefs.reportName ?? '')) await db.updatePreferences({ reportName: name.trim() || undefined });
      const { buildReport } = await import('@/lib/report/pdf');
      const report = await buildReport({ ...data, days: Number(days), patientName: name.trim() || undefined });
      downloadFile(report.blob, `symptom-report-${stamp()}.pdf`, 'application/pdf');
      toast.success(
        'Report downloaded',
        report.replacedCharacters ? { description: UNPRINTED_CHARACTERS, duration: 10_000 } : undefined,
      );
    } catch (e) {
      // The first report after an update, made offline, cannot load the report code.
      toast.error(reportErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group title="Doctor report">
      <Card className="p-4 space-y-3">
        <p className="text-sm text-muted">
          A clear PDF with your symptoms, daily chart, possible triggers, medications and full log. Bring it to your
          next appointment.
        </p>
        {enabled && !isPro ? (
          <UpgradeCard title="Doctor reports are part of Pro" compact />
        ) : (
          <>
            <Segmented<'30' | '90'>
              label="Report period"
              value={days}
              onChange={setDays}
              options={[
                { value: '30', label: 'Last 30 days' },
                { value: '90', label: 'Last 90 days' },
              ]}
            />
            <div>
              <Label htmlFor="report-name" hint="Optional. Printed on the report, stays on this device.">
                Your name
              </Label>
              <Input
                id="report-name"
                value={name}
                onChange={e => setName(e.target.value)}
                maxLength={80}
                autoComplete="name"
              />
            </div>
            <Button block onClick={generate} disabled={busy}>
              <FileText /> {busy ? 'Creating report…' : 'Download PDF report'}
            </Button>
          </>
        )}
      </Card>
    </Group>
  );
}

function BackupSection() {
  const { prefs, symptoms, factors } = useHealthData();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const last = prefs.lastBackupAt ? new Date(prefs.lastBackupAt) : null;
  const stale = !last || Date.now() - last.getTime() > 14 * 86_400_000;
  const hasData = symptoms.length + factors.length > 0;

  const backup = async () => {
    setBusy('backup');
    try {
      downloadFile(await exportBackup(), `myhealthyagent-backup-${stamp()}.json`, 'application/json');
      await db.updatePreferences({ lastBackupAt: new Date().toISOString() });
      toast.success('Backup downloaded', { description: 'Keep it somewhere safe, like iCloud Drive or Google Drive.' });
    } catch (e) {
      toast.error(errorMessage(e, 'Backup failed'));
    } finally {
      setBusy(null);
    }
  };

  const csv = async () => {
    setBusy('csv');
    try {
      downloadFile(await exportCSV(), `myhealthyagent-${stamp()}.csv`, 'text/csv;charset=utf-8');
    } catch (e) {
      toast.error(errorMessage(e, 'Export failed'));
    } finally {
      setBusy(null);
    }
  };

  const restore = async (file: File) => {
    setBusy('restore');
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('That file is too large to be a backup.');
      const r = await importBackup(await file.text());
      toast.success('Backup restored', { description: describeRestore(r) });
    } catch (e) {
      toast.error(errorMessage(e, 'Could not restore that file'));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Group title="Backup">
      <Card className="p-4 space-y-3">
        <p className="text-sm text-muted">
          Your data lives only in this browser. If you clear site data, lose your phone or switch devices, a backup file
          is the only way to get it back.
        </p>
        {hasData && stale && (
          <p className="text-sm rounded-xl bg-warn-soft text-warn px-3 py-2 font-medium">
            {last ? `Last backup was ${last.toLocaleDateString()}.` : 'You have not made a backup yet.'}
          </p>
        )}
        <Button block onClick={backup} disabled={busy !== null}>
          <Download /> {busy === 'backup' ? 'Preparing…' : 'Download backup'}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
            <Upload /> {busy === 'restore' ? 'Restoring…' : 'Restore'}
          </Button>
          <Button variant="secondary" onClick={csv} disabled={busy !== null}>
            <Table /> Spreadsheet
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) restore(f);
          }}
        />
        <p className="text-[13px] text-subtle">
          Restoring adds entries from the file, including any you deleted here. It never removes what is already here,
          and edits made on this device since the backup are kept.
        </p>
      </Card>
    </Group>
  );
}

async function copyKey(token: string) {
  try {
    await navigator.clipboard.writeText(token);
    toast.success('License key copied');
  } catch {
    toast.error('Could not copy. Select and copy the key manually.');
  }
}

function LicenseKey({ token }: { token: string }) {
  return <code className="block text-[12px] break-all rounded-lg bg-surface-2 p-2 text-muted select-all">{token}</code>;
}

export function ProSection() {
  const pro = usePro();
  if (!pro.enabled) return null;
  const token = pro.licenseToken;

  return (
    <Group title="Pro">
      <Card className="p-4 space-y-3">
        {pro.isPro ? (
          <>
            <p className="flex items-center gap-2 font-semibold text-ok">
              <Sparkles className="size-4" aria-hidden /> Pro is active on this device
            </p>
            <p className="text-sm text-muted">
              Save your license key to use Pro on another device. It is also included in backups.
            </p>
            {token && <LicenseKey token={token} />}
            <div className={config.billingPortalUrl ? 'grid grid-cols-2 gap-2' : undefined}>
              {token && (
                <Button variant="secondary" block onClick={() => copyKey(token)}>
                  Copy key
                </Button>
              )}
              {config.billingPortalUrl && <ManageBilling />}
            </div>
            {!config.billingPortalUrl && <ManageBilling />}
          </>
        ) : (
          <>
            {pro.licenseState === 'ended' && !pro.pendingCheckout && (
              <p className="text-sm rounded-xl bg-warn-soft text-warn px-3 py-2 font-medium">
                {config.billingPortalUrl
                  ? 'Your Pro license is no longer active. Renew below or manage billing.'
                  : 'Your Pro license is no longer active. Renew below.'}
              </p>
            )}
            <UpgradeCard />
            {token && (
              <>
                <LicenseKey token={token} />
                <Button variant="secondary" block onClick={() => copyKey(token)}>
                  Copy key
                </Button>
              </>
            )}
            <p className="text-sm text-muted pt-1">Already bought Pro on another device?</p>
            <LicenseKeyForm />
            {config.billingPortalUrl && (
              <p className="text-sm text-muted pt-1">
                Need to cancel, update your card or get an invoice? Stripe emails you a code to sign in, no key needed.
              </p>
            )}
            <ManageBilling />
          </>
        )}
        {token && <RemoveLicenseKey />}
      </Card>
    </Group>
  );
}

function RemoveLicenseKey() {
  const { removeKey } = usePro();
  const [confirming, setConfirming] = React.useState(false);
  if (!confirming) {
    return (
      <Button variant="quiet" block onClick={() => setConfirming(true)}>
        Remove license key from this device
      </Button>
    );
  }
  return (
    <div className="rounded-xl border border-line p-3 space-y-3">
      <p className="text-sm text-fg">
        Remove the license key from this device? Pro turns off here. Copy the key first if you want to use Pro again.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
        <Button
          variant="danger"
          onClick={async () => {
            try {
              await removeKey();
              toast.success('License key removed from this device');
            } catch (e) {
              toast.error(errorMessage(e, 'Could not remove the key'));
            }
          }}
        >
          Remove key
        </Button>
      </div>
    </div>
  );
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <Group title="Appearance">
      <Segmented<string>
        label="Theme"
        value={theme ?? 'system'}
        onChange={setTheme}
        options={[
          { value: 'system', label: 'Auto' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
      />
    </Group>
  );
}

function AboutSection() {
  return (
    <Group title="About">
      <Card className="divide-y divide-line">
        <Link href="/privacy" className="flex items-center gap-3 px-4 py-3 text-fg hover:bg-surface-2">
          <ShieldCheck className="size-4 text-muted" aria-hidden /> Privacy
        </Link>
        <Link href="/terms" className="flex items-center gap-3 px-4 py-3 text-fg hover:bg-surface-2">
          <FileText className="size-4 text-muted" aria-hidden /> Terms and medical disclaimer
        </Link>
        {config.supportEmail && (
          <a
            href={`mailto:${config.supportEmail}?subject=myHealthyAgent%20feedback`}
            className="flex items-center gap-3 px-4 py-3 text-fg hover:bg-surface-2"
          >
            <Mail className="size-4 text-muted" aria-hidden /> Send feedback
          </a>
        )}
      </Card>
      <p className="text-[13px] text-subtle mt-3">
        myHealthyAgent is a personal tracking tool. It does not diagnose, treat or give medical advice. In an emergency,
        call your local emergency number.
      </p>
    </Group>
  );
}

export function DeleteSection({ onDone }: { onDone: () => void }) {
  const pro = usePro();
  const [stage, setStage] = React.useState<'idle' | 'confirm'>('idle');
  const [text, setText] = React.useState('');
  const [keepChoice, setKeepChoice] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const token = pro.licenseToken;
  const hasLicense = Boolean(token || pro.pendingCheckout);
  const keepLicense = hasLicense && keepChoice;
  const erasingKey = Boolean(token) && !keepLicense;

  if (stage === 'idle') {
    return (
      <Button variant="quiet" block onClick={() => setStage('confirm')} className="text-danger">
        <Trash2 /> Delete all data
      </Button>
    );
  }
  return (
    <Card className="p-4 space-y-3 border-danger/40">
      <p className="font-semibold text-danger">Delete everything on this device?</p>
      <p className="text-sm text-muted">
        {erasingKey
          ? 'All symptoms, entries, medications, dose history, settings and your Pro license key will be erased. This cannot be undone. Download a backup first if you might want it later, and copy the key if you want to use Pro again.'
          : 'All symptoms, entries, medications, dose history and settings will be erased. This cannot be undone. Download a backup first if you might want it later.'}
      </p>
      {hasLicense && (
        <div className="rounded-xl bg-surface-2 p-3 space-y-3">
          {token && (
            <>
              <code className="block text-[12px] break-all text-muted select-all">{token}</code>
              <Button variant="secondary" size="sm" onClick={() => copyKey(token)}>
                Copy key
              </Button>
            </>
          )}
          {pro.pendingCheckout && !keepLicense && (
            <p className="text-sm text-muted">
              The Pro purchase that is still being confirmed will be forgotten too. Its reference is{' '}
              <span className="break-all font-mono text-[12px]">{pro.pendingCheckout.sessionId}</span>.
            </p>
          )}
          <label className="flex items-start gap-2 text-sm font-semibold text-fg">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-accent"
              checked={keepChoice}
              onChange={e => setKeepChoice(e.target.checked)}
            />
            {token ? 'Keep my Pro license key on this device' : 'Keep my Pro purchase on this device'}
          </label>
          {keepLicense && token && (
            <p className="text-sm text-muted">
              Your Pro license key stays on this device. Anyone using this browser can see it and use Pro.
            </p>
          )}
        </div>
      )}
      <div>
        <Label htmlFor="confirm-delete">Type DELETE to confirm</Label>
        <Input
          id="confirm-delete"
          value={text}
          onChange={e => setText(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            setStage('idle');
            setText('');
            setKeepChoice(false);
          }}
        >
          Cancel
        </Button>
        <Button
          variant="danger"
          disabled={text.trim().toUpperCase() !== 'DELETE' || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await db.deleteAllData({ keepLicense });
              toast.success(
                !keepLicense
                  ? 'All data deleted'
                  : token
                    ? 'All data deleted. Your Pro license key was kept.'
                    : 'All data deleted. Your Pro purchase was kept.',
              );
              onDone();
            } catch (e) {
              toast.error(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Delete
        </Button>
      </div>
    </Card>
  );
}
