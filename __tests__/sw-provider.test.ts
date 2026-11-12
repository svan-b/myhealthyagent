import { reloadOnUpdate } from '@/app/components/ServiceWorkerProvider';

/** Stands in for navigator.serviceWorker, with a controller and the controllerchange event. */
class FakeContainer extends EventTarget {
  controller: object | null;
  constructor(controller: object | null) {
    super();
    this.controller = controller;
  }
  takeOver(worker: object | null) {
    this.controller = worker;
    this.dispatchEvent(new Event('controllerchange'));
  }
}

function setup(controller: object | null, activeAtLoad: object | null) {
  const sw = new FakeContainer(controller);
  const reload = jest.fn();
  const updates = reloadOnUpdate(sw as unknown as ServiceWorkerContainer, reload);
  updates.registered({ active: activeAtLoad as ServiceWorker | null });
  return { sw, reload, updates };
}

const v1 = { name: 'v1' };
const v2 = { name: 'v2' };
const v3 = { name: 'v3' };

describe('reloading into a new version', () => {
  test('a first visit does not reload when the first worker takes over, and reloads once for a later update', () => {
    const { sw, reload, updates } = setup(null, null);
    expect(updates.hadWorker()).toBe(false);
    sw.takeOver(v1);
    expect(reload).not.toHaveBeenCalled();
    // From now on a waiting worker is an update, so the prompt may show.
    expect(updates.hadWorker()).toBe(true);
    sw.takeOver(v2);
    expect(reload).toHaveBeenCalledTimes(1);
    sw.takeOver(v3);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('a page that started under a worker reloads once when a new version takes over', () => {
    const { sw, reload, updates } = setup(v1, v1);
    expect(updates.hadWorker()).toBe(true);
    sw.takeOver(v2);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('a hard reloaded page (no controller, but a worker was active) also reloads for an update', () => {
    const { sw, reload, updates } = setup(null, v1);
    expect(updates.hadWorker()).toBe(true);
    sw.takeOver(v2);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('losing the worker is not an update', () => {
    const { sw, reload } = setup(v1, v1);
    sw.takeOver(null);
    expect(reload).not.toHaveBeenCalled();
  });

  test('stop() removes the listener', () => {
    const { sw, reload, updates } = setup(v1, v1);
    updates.stop();
    sw.takeOver(v2);
    expect(reload).not.toHaveBeenCalled();
  });
});
