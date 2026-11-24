import type { Bucket, LogSegment, PlatformView } from "@openboard/ports";
import type { Deps } from "../deps.ts";
import type { Tenants } from "../http/scope.ts";
import type { OrgJobHandler } from "./registry.ts";

export const SHIP_LOG_JOB = "ship-log";
const interval = 10_000;
const pageSize = 100;
const concurrency = 8;

export const orgPrefix = (orgId: number) => `org/${orgId}/`;

function upload(bucket: Bucket, orgId: number, { boardId, first, last, events, deadline }: LogSegment) {
  const stream = boardId === null ? "log" : `board/${boardId}`;
  const key = `${orgPrefix(orgId)}${stream}/${first}-${last}.ndjson.gz`;
  const ndjson = events.map((event) => `${JSON.stringify(event)}\n`).join("");
  return bucket.put(key, Bun.gzipSync(new TextEncoder().encode(ndjson)), deadline);
}

export function logShippingJobs(
  bucket: Bucket,
  platform: PlatformView,
  tenants: Tenants,
  deps: Deps,
  signal: AbortSignal,
) {
  async function shipOrg(orgId: number, stopped: () => boolean) {
    if (stopped()) return;
    try {
      await tenants.jobOrg({ orgId }).shipLogs((segment) => upload(bucket, orgId, segment), stopped, deps.now);
    } catch {
      deps.log.error("log shipping failed", { orgId });
    }
  }

  async function scan(after: number, stopped: () => boolean) {
    while (!stopped()) {
      const orgs = await platform.shippingOrgs(after, pageSize);
      for (let i = 0; i < orgs.length; i += concurrency) {
        if (stopped()) return after;
        const batch = orgs.slice(i, i + concurrency);
        await Promise.all(batch.map((orgId) => shipOrg(orgId, stopped)));
        after = batch.at(-1) ?? after;
      }
      if (orgs.length < pageSize) return 0;
    }
    return after;
  }

  const shipment: OrgJobHandler = {
    async run(_org, job, lease) {
      const board = tenants.jobBoard(job);
      const payload = await board.write((writer) => writer.readJob(job.id, lease, deps.now()));
      if (!payload) return false;
      const after = Number(payload.after ?? 0);
      const stopped = () => signal.aborted || deps.now() >= lease.claimedAt + interval;
      const next = await scan(after, stopped);
      return board.write(async (writer) => {
        if ((await writer.takeJob(job.id, lease, deps.now())) === null) return false;
        await writer.enqueue(SHIP_LOG_JOB, lease.claimedAt + interval, { after: next });
        return true;
      });
    },
  };
  return { [SHIP_LOG_JOB]: shipment };
}
