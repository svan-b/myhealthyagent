/**
 * @jest-environment jsdom
 */
// The Reports sheet: what the person is told after making a report (F21) or when the report code could
// not be loaded, as on the first offline start after an update (R2).
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { toast } from 'sonner';
import { ReportSection } from '@/app/components/settings/SettingsSheet';
import { downloadFile } from '@/lib/db/backup';
import { isLoadError, REPORT_NEEDS_CONNECTION, reportErrorMessage, UNPRINTED_CHARACTERS } from '@/lib/report/messages';

const mockData = {
  symptoms: [],
  factors: [],
  schedules: [],
  doses: [],
  prefs: { id: 'user-preferences', customSymptoms: [], customFactors: [], streakCount: 0 },
  loading: false,
  error: null,
  reload: async () => {},
};
const mockBuild = jest.fn();

jest.mock('@/lib/hooks/useHealthData', () => ({ useHealthData: () => mockData }));
jest.mock('@/lib/pro/client', () => ({ usePro: () => ({ isPro: false, enabled: false }) }));
jest.mock('@/lib/db/client', () => ({ db: { updatePreferences: async () => {} } }));
jest.mock('@/lib/db/backup', () => ({ ...jest.requireActual('@/lib/db/backup'), downloadFile: jest.fn() }));
jest.mock('@/lib/report/pdf', () => ({ buildReport: (...args: unknown[]) => mockBuild(...args) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
const mockToast = jest.mocked(toast);
const mockDownload = jest.mocked(downloadFile);

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  jest.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<ReportSection />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function download() {
  const button = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Download PDF report'))!;
  await act(async () => button.click());
}

const blob = new Blob(['%PDF-'], { type: 'application/pdf' });

test('after the download, says when some characters could not be printed', async () => {
  mockBuild.mockResolvedValue({ blob, replacedCharacters: true });
  await download();
  expect(mockDownload).toHaveBeenCalledWith(blob, expect.stringMatching(/^symptom-report-.*\.pdf$/), 'application/pdf');
  expect(mockToast.success).toHaveBeenCalledWith(
    'Report downloaded',
    expect.objectContaining({ description: UNPRINTED_CHARACTERS }),
  );
  expect(UNPRINTED_CHARACTERS).toBe(
    'Some characters, like emoji, could not be printed in the PDF. They are still in the app and in the spreadsheet export.',
  );
});

test('says nothing more when every character was printed', async () => {
  mockBuild.mockResolvedValue({ blob, replacedCharacters: false });
  await download();
  expect(mockToast.success).toHaveBeenCalledWith('Report downloaded', undefined);
});

test('a report code file that cannot be loaded gets a plain message instead of the raw error', async () => {
  const error = Object.assign(
    new Error('Loading chunk 832 failed.\n(error: https://example.com/_next/static/chunks/832.js)'),
    { name: 'ChunkLoadError' },
  );
  mockBuild.mockRejectedValue(error);
  await download();
  expect(mockToast.error).toHaveBeenCalledWith(
    'Reports need an internet connection the first time after an update. Connect once, then try again.',
  );
});

test('other errors keep their own message', async () => {
  mockBuild.mockRejectedValue(new Error('Out of memory'));
  await download();
  expect(mockToast.error).toHaveBeenCalledWith('Out of memory');
});

describe('which errors mean the report code could not be loaded', () => {
  test.each([
    ['webpack', Object.assign(new Error('Loading chunk 832 failed.'), { name: 'ChunkLoadError' })],
    ['webpack CSS', new Error('Loading CSS chunk 12 failed.')],
    ['Chrome', new TypeError('Failed to fetch dynamically imported module: https://example.com/_next/a.js')],
    ['Safari', new TypeError('Importing a module script failed.')],
    ['Firefox', new TypeError('error loading dynamically imported module: https://example.com/_next/a.js')],
  ])('%s', (_, error) => {
    expect(isLoadError(error)).toBe(true);
    expect(reportErrorMessage(error)).toBe(REPORT_NEEDS_CONNECTION);
  });

  test.each([new Error('Something else'), new TypeError('Failed to fetch'), 'not an error', null])('not %p', error => {
    expect(isLoadError(error)).toBe(false);
  });

  test('a thrown value that is not an error gets the general message', () => {
    expect(reportErrorMessage('oops')).toBe('Could not create the report');
  });
});
