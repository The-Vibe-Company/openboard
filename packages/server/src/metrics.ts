import { getMetrics } from "@openboard/contract";
import type { Jobs, WebhookOutcome } from "@openboard/ports";

const bounds = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5] as const;
const outcomes = ["done", "retry", "dead", "skipped"] as const;

type Labels = Readonly<Record<string, string>>;
type Sample = (name: string, value: number, labels?: Labels) => void;

function histogram() {
  const buckets = bounds.map(() => 0);
  let count = 0;
  let sum = 0;
  return {
    observe(ms: number) {
      const seconds = Math.max(0, ms) / 1000;
      const first = bounds.findIndex((bound) => seconds <= bound);
      if (first !== -1) buckets[first]!++;
      count++;
      sum += seconds;
    },
    append(sample: Sample, name: string, labels: Labels) {
      let cumulative = 0;
      bounds.forEach((bound, index) => {
        cumulative += buckets[index]!;
        sample(`${name}_bucket`, cumulative, { ...labels, le: String(bound) });
      });
      sample(`${name}_bucket`, count, { ...labels, le: "+Inf" });
      sample(`${name}_sum`, sum, labels);
      sample(`${name}_count`, count, labels);
    },
  };
}

function escapeLabel(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}

export function instanceMetrics(instance: string, residentBytes: () => number) {
  const route = `${getMetrics.route.mount ?? ""}${getMetrics.route.path}`;
  const requests = new Map<string, { labels: Labels; timing: ReturnType<typeof histogram> }>([
    [
      `${getMetrics.name} ${route} 200`,
      { labels: { route, operation: getMetrics.name, status: "200" }, timing: histogram() },
    ],
  ]);
  const locks = histogram();
  const webhooks = new Map<WebhookOutcome, number>();
  let streams = 0;
  let failures = 0;
  return {
    request(route: string, operation: string, status: number, ms: number) {
      const key = `${operation} ${route} ${status}`;
      let series = requests.get(key);
      if (!series) {
        series = { labels: { route, operation, status: String(status) }, timing: histogram() };
        requests.set(key, series);
      }
      series.timing.observe(ms);
      if (status === 401) failures++;
    },
    boardLock: locks.observe,
    stream(delta: 1 | -1) {
      streams += delta;
    },
    webhook(outcome: WebhookOutcome) {
      webhooks.set(outcome, (webhooks.get(outcome) ?? 0) + 1);
    },
    render(jobs: Awaited<ReturnType<Jobs["dueMetrics"]>>, now: number) {
      const lines: string[] = [];
      const type = (name: string, kind: string) => lines.push(`# TYPE openboard_${name} ${kind}`);
      const sample: Sample = (name, value, labels) => {
        const list = Object.entries({ instance, ...labels }).map(([key, text]) => `${key}="${escapeLabel(text)}"`);
        lines.push(`openboard_${name}{${list.join(",")}} ${value}`);
      };
      type("process_resident_bytes", "gauge");
      sample("process_resident_bytes", residentBytes());
      type("request_duration_seconds", "histogram");
      for (const { labels, timing } of requests.values()) timing.append(sample, "request_duration_seconds", labels);
      type("board_lock_wait_seconds", "histogram");
      locks.append(sample, "board_lock_wait_seconds", {});
      type("open_streams", "gauge");
      sample("open_streams", streams);
      type("jobs_due", "gauge");
      for (const { kind, count } of jobs) sample("jobs_due", count, { kind });
      type("jobs_oldest_due_seconds", "gauge");
      for (const { kind, oldest } of jobs) {
        sample("jobs_oldest_due_seconds", oldest === null ? 0 : (now - oldest) / 1000, { kind });
      }
      type("webhook_deliveries_total", "counter");
      for (const outcome of outcomes) sample("webhook_deliveries_total", webhooks.get(outcome) ?? 0, { outcome });
      type("auth_failures_total", "counter");
      sample("auth_failures_total", failures);
      return `${lines.join("\n")}\n`;
    },
  };
}

export type Metrics = ReturnType<typeof instanceMetrics>;
