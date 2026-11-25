import type { createClient } from "@the-vibe-company/openboard";

export function createLinkedLauncher<Wake = never>(
  routine: Pick<ReturnType<typeof createClient>, "postMessage" | "labelMessage">,
  launch: (thread: string, deliveryId: string, options?: Wake) => Promise<(() => void) | void>,
  urlTemplate?: string,
  finishLabel = (thread: string, run: string) => routine.labelMessage({ id: thread, set: { run } }),
) {
  const unlinked = new Map<string, (() => void) | undefined>();
  const latestRun = new Map<string, string>();

  return async (thread: string, deliveryId: string, options?: Wake) => {
    const clientId = `routine-run:${deliveryId}`;
    if (!unlinked.has(deliveryId)) {
      unlinked.set(deliveryId, (await launch(thread, deliveryId, options)) ?? undefined);
      latestRun.set(thread, deliveryId);
    }
    const url = urlTemplate?.replaceAll("{id}", () => encodeURIComponent(deliveryId));
    await routine.postMessage({
      re: thread,
      id: clientId,
      text: `Run ${deliveryId} started${url ? `: ${url}` : ""}`,
    });
    // A dead delivery can be resent after a newer run already started for this thread.
    if (latestRun.get(thread) === deliveryId) {
      await finishLabel(thread, deliveryId);
      unlinked.get(deliveryId)?.();
    }
    unlinked.delete(deliveryId);
  };
}
