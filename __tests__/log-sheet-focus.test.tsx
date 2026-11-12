/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Sheet } from '@/components/ui/sheet';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Days = Record<string, number[]>;

/** List changes held back until the test runs them, like the real list, which reloads after the sheet closed. */
const later: (() => void)[] = [];
const runLater = () => act(async () => later.splice(0).forEach(f => f()));

/**
 * Works like the History screen. Rows open an edit sheet that is only mounted while it is open. With reloads on,
 * a delete or a new date reaches the list only when runLater is called.
 */
function HistoryLike({ reloads = false }: { reloads?: boolean }) {
  const [days, setDays] = React.useState<Days>({ today: [0, 1, 2, 3, 4], yesterday: [5] });
  const [editing, setEditing] = React.useState<number | null>(null);
  const update = (change: (d: Days) => Days) => (reloads ? later.push(() => setDays(change)) : setDays(change));
  return (
    <main>
      <h1>History</h1>
      <input id="search" aria-label="Search" />
      {Object.entries(days).map(([day, rows]) => (
        <section key={day}>
          {rows.map(i => (
            <button key={i} id={`entry-${i}`} type="button" onClick={() => setEditing(i)}>
              Row {i}
            </button>
          ))}
        </section>
      ))}
      {editing !== null && (
        <Sheet
          open
          onOpenChange={o => !o && setEditing(null)}
          title="Edit symptom"
          footer={
            <>
              <button id="save" type="button" onClick={() => setEditing(null)}>
                Save changes
              </button>
              <button
                id="move"
                type="button"
                onClick={() => {
                  // A new date moves the entry to another day, so it is drawn again as a new element.
                  update(d => ({ today: d.today.filter(x => x !== editing), yesterday: [editing, ...d.yesterday] }));
                  setEditing(null);
                }}
              >
                Save new date
              </button>
              <button
                id="delete"
                type="button"
                onClick={() => {
                  update(d => ({ today: d.today.filter(x => x !== editing), yesterday: d.yesterday }));
                  setEditing(null);
                }}
              >
                Delete for good
              </button>
            </>
          }
        >
          <input id="edit-name" aria-label="Name" />
        </Sheet>
      )}
    </main>
  );
}

/** Works like the app header and the Reports and data sheet, which is always mounted and opened through a prop. */
function SettingsLike() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <header>
        <button id="menu" type="button" onClick={() => setOpen(true)}>
          Reports and data
        </button>
      </header>
      <main>
        <h1>Log</h1>
      </main>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Reports and data"
        description="Everything here runs on your device."
      >
        <button type="button">Download backup</button>
      </Sheet>
    </>
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  // Let any focus watching from the last test end before the next one starts.
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
});

const wait = (ms: number) => act(async () => void (await new Promise(r => setTimeout(r, ms))));
const render = async (el: React.ReactElement) => {
  await act(async () => root.render(el));
  await wait(10);
};
const byId = (id: string) => document.getElementById(id)!;
const focused = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return 'body';
  return el.id ? `#${el.id}` : el.closest('[role="dialog"]') ? 'in sheet' : el.tagName.toLowerCase();
};
/** Keyboard users focus a control and press Enter, which clicks it. */
const pressEnterOn = async (id: string) => {
  byId(id).focus();
  await act(async () => byId(id).click());
  await wait(10);
};
const closeWith = async (how: 'Escape' | 'Close' | 'save' | 'move' | 'delete') => {
  if (how === 'Escape') {
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
  } else {
    const el =
      how === 'Close' ? document.querySelector<HTMLElement>('[role="dialog"] [aria-label="Close"]')! : byId(how);
    el.focus();
    await act(async () => el.click());
  }
  await wait(10);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
};

describe('closing a sheet puts focus back on what opened it', () => {
  it.each(['Escape', 'Close', 'save'] as const)('after %s', async how => {
    await render(<HistoryLike />);
    await pressEnterOn('entry-3');
    expect(focused()).toBe('in sheet');
    await closeWith(how);
    expect(focused()).toBe('#entry-3');
  });

  it('when the opener was clicked without getting focus, as in Safari', async () => {
    await render(<HistoryLike />);
    byId('search').focus();
    // A click does not move focus here, so the search field keeps it, like a tap in Safari.
    await act(async () => byId('entry-2').click());
    await wait(10);
    await closeWith('Escape');
    expect(focused()).toBe('#entry-2');
  });

  it('from a sheet that stays mounted and is opened from the header', async () => {
    await render(<SettingsLike />);
    await pressEnterOn('menu');
    expect(focused()).toBe('in sheet');
    await closeWith('Escape');
    expect(focused()).toBe('#menu');
    await pressEnterOn('menu');
    await closeWith('Close');
    expect(focused()).toBe('#menu');
  });

  it('in strict mode, focus stays in the open sheet and comes back on close', async () => {
    await render(
      <React.StrictMode>
        <HistoryLike />
      </React.StrictMode>,
    );
    await pressEnterOn('entry-1');
    await wait(20);
    expect(focused()).toBe('in sheet');
    await closeWith('Escape');
    expect(focused()).toBe('#entry-1');
  });

  it('follows the entry when it is drawn again in another place', async () => {
    await render(<HistoryLike />);
    await pressEnterOn('entry-4');
    const before = byId('entry-4');
    await closeWith('move');
    expect(byId('entry-4')).not.toBe(before);
    expect(focused()).toBe('#entry-4');
  });
});

describe('when the opener is gone', () => {
  it('focuses the screen heading', async () => {
    await render(<HistoryLike />);
    await pressEnterOn('entry-3');
    await closeWith('delete');
    const heading = document.querySelector('h1')!;
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });

  it('focuses the screen heading when the list drops the entry only after the sheet has closed', async () => {
    await render(<HistoryLike reloads />);
    await pressEnterOn('entry-3');
    await closeWith('delete');
    // The row is still there for a moment, so focus goes back to it first.
    expect(focused()).toBe('#entry-3');
    await runLater();
    await wait(10);
    expect(byId('entry-3')).toBeNull();
    expect(document.activeElement).toBe(document.querySelector('h1'));
  });

  it('follows an entry that is drawn again only after the sheet has closed', async () => {
    await render(<HistoryLike reloads />);
    await pressEnterOn('entry-0');
    const before = byId('entry-0');
    await closeWith('move');
    expect(document.activeElement).toBe(before);
    await runLater();
    await wait(10);
    expect(byId('entry-0')).not.toBe(before);
    expect(focused()).toBe('#entry-0');
  });

  it('leaves focus alone once the person has moved on', async () => {
    await render(<HistoryLike reloads />);
    await pressEnterOn('entry-3');
    await closeWith('delete');
    // A tap on empty space takes focus off the row before the list drops it.
    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      byId('entry-3').blur();
    });
    await runLater();
    await wait(10);
    expect(focused()).toBe('body');
  });
});
