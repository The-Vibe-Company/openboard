export function webhookOutcome(status: number | null) {
  return { state: status !== null && status >= 200 && status < 300 ? "done" : "dead", status } as const;
}

const retrySeconds = [10, 30, 120, 600, 1_800, 3_600, 10_800, 21_600, 43_200];

function retryAfterMs(header: string | null | undefined, now: number): number | null {
  const value = header?.trim();
  if (!value) return null;
  const httpDate = /^[a-z]{3}, \d{2} [a-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/i;
  // oxlint-disable-next-line no-restricted-globals -- Parsing an explicit UTC timestamp never reads the wall clock.
  const date = httpDate.test(value) ? Date.parse(value) : NaN;
  const delay = /^\d+$/.test(value) ? Number(value) * 1_000 : date - now;
  return delay >= 0 && delay <= 3_600_000 ? delay : null;
}

export function webhookRetryAt({
  status,
  error,
  retryAfter,
  attempt,
  now,
}: {
  status: number | null;
  error: string | null;
  retryAfter?: string | null;
  attempt: number;
  now: number;
}): number | null {
  const seconds = retrySeconds[attempt - 1];
  if (seconds === undefined) return null;
  const retryableClientStatus = status === 408 || status === 425 || status === 429;
  if (status !== null && status >= 400 && status < 500 && !retryableClientStatus) return null;
  const retryable =
    retryableClientStatus ||
    error === "timeout" ||
    error === "request_failed" ||
    (status !== null && status >= 500 && status < 600);
  return retryable ? now + (retryAfterMs(retryAfter, now) ?? seconds * 1_000) : null;
}
