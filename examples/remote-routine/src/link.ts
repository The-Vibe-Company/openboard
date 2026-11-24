import type { createClient } from "@the-vibe-company/openboard";

export function createLinkedLauncher(
  routine: Pick<ReturnType<typeof createClient>, "postMessage" | "labelMessage">,
  launch: (thread: string, deliveryId: string) => Promise<unknown>,
  urlTemplate?: string,
) {
  const unlinked = new Set<string>();
  const latestRun = new Map<string, string>();

  return async (thread: string, deliveryId: string) => {
    const clientId = `routine-run:${deliveryId}`;
    if (!unlinked.has(deliveryId)) {
      await launch(thread, deliveryId);
      unlinked.add(deliveryId);
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
      await routine.labelMessage({ id: thread, set: { run: deliveryId } });
    }
    unlinked.delete(deliveryId);
  };
}
