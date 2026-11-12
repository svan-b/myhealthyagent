// lib/report/messages.ts
// What the Reports sheet tells the person about a report. Kept apart from the report code, which only
// loads when a report is made.
import { errorMessage } from '@/lib/utils';

/** Shown after the download when the PDF could not print some characters. */
export const UNPRINTED_CHARACTERS =
  'Some characters, like emoji, could not be printed in the PDF. They are still in the app and in the spreadsheet export.';

/** Shown when the report code could not be loaded, which happens offline before it was saved for offline use. */
export const REPORT_NEEDS_CONNECTION =
  'Reports need an internet connection the first time after an update. Connect once, then try again.';

/**
 * True when code that loads on demand could not be fetched. Webpack throws a ChunkLoadError, and browsers
 * that load the module themselves throw a TypeError whose message depends on the browser.
 */
export function isLoadError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return (
    e.name === 'ChunkLoadError' ||
    /Loading (CSS )?chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
      e.message,
    )
  );
}

/** What to tell the person when a report could not be made. */
export function reportErrorMessage(e: unknown): string {
  return isLoadError(e) ? REPORT_NEEDS_CONNECTION : errorMessage(e, 'Could not create the report');
}
