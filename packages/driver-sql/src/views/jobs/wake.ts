import type { JobSchedule } from "@openboard/ports";

const maxDelay = 2_147_483_647;
const retryDelay = 1_000;

export function jobWake(
  now: () => number,
  schedule: JobSchedule,
  read: () => Promise<number | null>,
  wake: () => Promise<number | null>,
) {
  let due: number | null = null;
  let hinted: number | null = null;
  let cancel: (() => void) | undefined;
  let stopped = false;
  let busy = false;
  let catchUp = false;

  function arm(at: number | null) {
    cancel?.();
    cancel = undefined;
    due = at;
    if (stopped || at === null) return;
    cancel = schedule(Math.min(maxDelay, Math.max(0, at - now())), () => {
      cancel = undefined;
      if (stopped) return;
      if (at > now()) arm(at);
      else return reconcile(wake);
    });
  }

  async function reconcile(work: () => Promise<number | null>) {
    busy = true;
    try {
      do {
        catchUp = false;
        hinted = null;
        const next = await work().catch(() => now() + retryDelay);
        if (!catchUp) arm(earliest(next, hinted));
        work = read;
      } while (!stopped && catchUp);
    } finally {
      busy = false;
    }
  }

  return {
    notify(at: number) {
      if (stopped) return;
      if (busy) hinted = earliest(hinted, at);
      else if (due === null || at < due) arm(at);
    },
    refresh() {
      if (stopped) return;
      if (busy) catchUp = true;
      else {
        arm(null);
        void reconcile(read);
      }
    },
    stop() {
      stopped = true;
      arm(null);
    },
  };
}

function earliest(first: number | null, second: number | null): number | null {
  return first === null ? second : second === null ? first : Math.min(first, second);
}
