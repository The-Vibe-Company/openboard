interface Receipt {
  readonly id: string;
  readonly attempt: number;
  readonly thread: string;
  readonly cursor: string;
}

/** Records every inbound POST and applies its effect once per Standard Webhooks delivery ID. */
export function webhookReceiver() {
  const posts: Receipt[] = [];
  const applied = new Map<string, Receipt>();
  return {
    posts,
    applied,
    async fetch(request: Request): Promise<Response> {
      const id = request.headers.get("webhook-id");
      if (request.method !== "POST" || !id) throw new Error("expected a POST with webhook-id");
      const { delivery, subject, event } = (await request.json()) as {
        delivery: { id: string; attempt: number };
        subject: { thread: string };
        event: { cursor: string };
      };
      if (delivery.id !== id) throw new Error("delivery ID differs from webhook-id");
      const post = { id, attempt: delivery.attempt, thread: subject.thread, cursor: event.cursor };
      posts.push(post);
      if (!applied.has(id)) applied.set(id, post);
      return new Response(null, { status: 204 });
    },
  };
}
