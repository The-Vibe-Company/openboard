export function webhookOutcome(status: number | null) {
  return { state: status !== null && status >= 200 && status < 300 ? "done" : "dead", status } as const;
}
