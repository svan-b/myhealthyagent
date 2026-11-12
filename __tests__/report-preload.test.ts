/** @jest-environment node */
// The app loads the report code in idle time so the service worker caches it for offline use (F16).
// Everything a report loads on demand, the fonts included, must be part of that.

test('preloading loads every module the report loads on demand, the fonts included', async () => {
  const loaded: string[] = [];
  await jest.isolateModulesAsync(async () => {
    for (const name of ['jspdf', 'jspdf-autotable', '@/lib/report/noto-sans']) {
      jest.doMock(name, () => {
        loaded.push(name);
        return jest.requireActual(name);
      });
    }
    const { preloadReportLibs } = await import('@/lib/report/pdf');
    await preloadReportLibs();
  });
  expect(loaded.sort()).toEqual(['@/lib/report/noto-sans', 'jspdf', 'jspdf-autotable']);
});

test('a report loads nothing on demand that preloading leaves out', async () => {
  const preloaded = new Set<string>();
  const used = new Set<string>();
  let into = preloaded;
  await jest.isolateModulesAsync(async () => {
    for (const name of ['jspdf', 'jspdf-autotable', '@/lib/report/noto-sans']) {
      jest.doMock(name, () => {
        into.add(name);
        return jest.requireActual(name);
      });
    }
    const { preloadReportLibs } = await import('@/lib/report/pdf');
    await preloadReportLibs();
  });
  into = used;
  await jest.isolateModulesAsync(async () => {
    for (const name of ['jspdf', 'jspdf-autotable', '@/lib/report/noto-sans']) {
      jest.doMock(name, () => {
        into.add(name);
        return jest.requireActual(name);
      });
    }
    const { buildReport } = await import('@/lib/report/pdf');
    await buildReport({ symptoms: [], factors: [], schedules: [], doses: [], days: 30 });
  });
  expect([...used].every(name => preloaded.has(name))).toBe(true);
  expect(used.size).toBeGreaterThan(0);
});
