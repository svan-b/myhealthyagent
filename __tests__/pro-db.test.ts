/**
 * @jest-environment node
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { db, normalizePreferences } from '@/lib/db/client';
import { resetDBConnection } from '@/lib/db/init';

// The client announces changes on a BroadcastChannel, which would keep Node running after the tests.
(globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;

const KEY = 'mha1.payload.signature';
const NEW_KEY = 'mha1.newer.signature';

beforeEach(() => {
  resetDBConnection();
  globalThis.indexedDB = new IDBFactory();
});

async function seed() {
  await db.addSymptom({ id: 's1', name: 'Headache', severity: 5, timestamp: new Date().toISOString() });
  await db.updatePreferences({
    onboardedAt: '2026-01-01T00:00:00.000Z',
    reportName: 'Sam',
    licenseToken: KEY,
    licenseCheckedAt: '2026-11-01T00:00:00.000Z',
    pendingCheckout: { sessionId: 'cs_test_pending12345', since: '2026-11-10T00:00:00.000Z' },
  });
}

describe('Delete all data and the license key (F15)', () => {
  it('removes the license key by default, along with everything else', async () => {
    await seed();
    await db.deleteAllData();
    const prefs = await db.getPreferences();
    expect(prefs.licenseToken).toBeUndefined();
    expect(prefs.licenseCheckedAt).toBeUndefined();
    expect(prefs.pendingCheckout).toBeUndefined();
    // Without a key the app starts over, as on a new device.
    expect(prefs.onboardedAt).toBeUndefined();
    expect(prefs.reportName).toBeUndefined();
    expect(await db.getAllSymptoms()).toEqual([]);
  });

  it('keeps only the license when the person chooses to', async () => {
    await seed();
    await db.deleteAllData({ keepLicense: true });
    const prefs = await db.getPreferences();
    expect(prefs.licenseToken).toBe(KEY);
    expect(prefs.licenseCheckedAt).toBe('2026-11-01T00:00:00.000Z');
    expect(prefs.pendingCheckout).toEqual({ sessionId: 'cs_test_pending12345', since: '2026-11-10T00:00:00.000Z' });
    expect(prefs.onboardedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(prefs.reportName).toBeUndefined();
    expect(await db.getAllSymptoms()).toEqual([]);
  });
});

describe('preferences', () => {
  it('keeps a purchase that is being confirmed through reads and unrelated writes (F04)', async () => {
    await db.updatePreferences({
      pendingCheckout: { sessionId: 'cs_live_abcdefghijklm', since: '2026-11-12T10:00:00Z' },
    });
    await db.updatePreferences({ streakCount: 3 });
    expect((await db.getPreferences()).pendingCheckout).toEqual({
      sessionId: 'cs_live_abcdefghijklm',
      since: '2026-11-12T10:00:00Z',
    });
    expect(normalizePreferences({ pendingCheckout: { sessionId: 42 } }).pendingCheckout).toBeUndefined();
    expect(normalizePreferences({ pendingCheckout: 'cs_x' }).pendingCheckout).toBeUndefined();
  });

  it('a check and its write happen in one transaction, so a stale answer cannot land on a newer key (F14)', async () => {
    await db.updatePreferences({ licenseToken: KEY, licenseCheckedAt: new Date(0).toISOString() });
    // A newer key is stored while an answer about the old one is on its way.
    await db.updatePreferences({ licenseToken: NEW_KEY, licenseCheckedAt: '2026-11-12T10:00:00.000Z' });
    const stale = await db.updatePreferences(cur =>
      cur.licenseToken === KEY ? { licenseCheckedAt: new Date(0).toISOString() } : null,
    );
    expect(stale.licenseCheckedAt).toBe('2026-11-12T10:00:00.000Z');
    expect(await db.getPreferences()).toMatchObject({
      licenseToken: NEW_KEY,
      licenseCheckedAt: '2026-11-12T10:00:00.000Z',
    });

    // Two guarded writes racing: each sees what the other committed.
    await Promise.all([
      db.updatePreferences(cur => (cur.streakCount === 0 ? { streakCount: 1 } : null)),
      db.updatePreferences(cur => (cur.streakCount === 0 ? { streakCount: 2 } : null)),
    ]);
    expect((await db.getPreferences()).streakCount).toBe(1);
  });
});
