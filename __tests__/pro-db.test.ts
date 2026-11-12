/**
 * @jest-environment node
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { db, normalizePreferences } from '@/lib/db/client';
import { initDB, resetDBConnection } from '@/lib/db/init';
import { DEFAULT_PREFERENCES } from '@/lib/db/schema';

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
    pendingCheckouts: [
      { sessionId: 'cs_test_pending12345', since: '2026-11-10T00:00:00.000Z' },
      { sessionId: 'cs_test_pending67890', since: '2026-11-11T00:00:00.000Z' },
    ],
  });
}

describe('Delete all data and the license key (F15)', () => {
  it('removes the license key by default, along with everything else', async () => {
    await seed();
    await db.deleteAllData();
    const prefs = await db.getPreferences();
    expect(prefs.licenseToken).toBeUndefined();
    expect(prefs.licenseCheckedAt).toBeUndefined();
    expect(prefs.pendingCheckouts).toBeUndefined();
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
    expect(prefs.pendingCheckouts).toEqual([
      { sessionId: 'cs_test_pending12345', since: '2026-11-10T00:00:00.000Z' },
      { sessionId: 'cs_test_pending67890', since: '2026-11-11T00:00:00.000Z' },
    ]);
    expect(prefs.onboardedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(prefs.reportName).toBeUndefined();
    expect(await db.getAllSymptoms()).toEqual([]);
  });
});

describe('preferences', () => {
  it('keeps purchases that are being confirmed through reads and unrelated writes (F04, P1)', async () => {
    const one = { sessionId: 'cs_live_abcdefghijklm', since: '2026-11-12T10:00:00Z' };
    const two = { sessionId: 'cs_live_nopqrstuvwxyz', since: '2026-11-12T11:00:00Z' };
    await db.updatePreferences({ pendingCheckouts: [one, two] });
    await db.updatePreferences({ streakCount: 3 });
    expect((await db.getPreferences()).pendingCheckouts).toEqual([one, two]);
    // Malformed entries and repeats are dropped, and an empty list reads as none.
    expect(
      normalizePreferences({ pendingCheckouts: [{ sessionId: 42 }, 'cs_x', one, { ...one }] }).pendingCheckouts,
    ).toEqual([one]);
    expect(normalizePreferences({ pendingCheckouts: 'cs_x' }).pendingCheckouts).toBeUndefined();
    expect(normalizePreferences({ pendingCheckouts: [] }).pendingCheckouts).toBeUndefined();
  });

  it('reads the single purchase the previous version saved, and moves it into the list (P1)', async () => {
    const old = { sessionId: 'cs_live_savedbyoldapp1', since: '2026-11-10T10:00:00Z' };
    const newer = { sessionId: 'cs_live_savedbynewapp2', since: '2026-11-12T10:00:00Z' };
    expect(normalizePreferences({ pendingCheckout: old }).pendingCheckouts).toEqual([old]);
    expect(normalizePreferences({ pendingCheckout: old, pendingCheckouts: [newer, old] }).pendingCheckouts).toEqual([
      old,
      newer,
    ]);
    expect(normalizePreferences({ pendingCheckout: { sessionId: 42 } }).pendingCheckouts).toBeUndefined();

    // A record written by the previous version, as it is in IndexedDB.
    const idb = await initDB();
    await idb.put('preferences', { ...DEFAULT_PREFERENCES, pendingCheckout: old });
    await db.updatePreferences({ streakCount: 1 });
    const stored = (await idb.get('preferences', 'user-preferences')) as Record<string, unknown>;
    expect(stored.pendingCheckouts).toEqual([old]);
    expect(stored.pendingCheckout).toBeUndefined();
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
