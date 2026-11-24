import { BoardError, type Client } from "@the-vibe-company/openboard";
import { type FormEvent, useState } from "react";
import { webhookError, webhookRequest } from "../api/webhooks.ts";
import "./WebhookForm.css";

export function WebhookForm({
  create,
}: {
  create: (request: Parameters<Client["createWebhook"]>[0]) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const tailError = error instanceof BoardError && error.code === "bad_watcher";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    setError(null);
    setBusy(true);
    try {
      await create(webhookRequest(new FormData(form)));
      form.reset();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="webhook-form" onSubmit={submit}>
      <fieldset disabled={busy}>
        <legend>Create a webhook</legend>
        <label>
          Name
          <input name="name" required maxLength={100} />
        </label>
        <label>
          Receiver URL
          <input name="url" type="url" required maxLength={4096} />
        </label>
        <label>
          Channel or tail
          <input
            name="tail"
            maxLength={4096}
            placeholder="dev --label status=ready"
            aria-invalid={tailError || undefined}
            aria-describedby={tailError ? "webhook-tail-error" : undefined}
            onChange={() => tailError && setError(null)}
          />
        </label>
        {tailError && (
          <p id="webhook-tail-error" role="alert">
            {error.message}
          </p>
        )}
        <label>
          Event types (comma-separated)
          <input name="types" placeholder="labels.changed" />
        </label>
        <p>Leave event types blank to include all matching events.</p>
        <button type="submit">Create webhook</button>
      </fieldset>
      {error != null && !tailError && <p role="alert">{webhookError(error, "Could not create the webhook.")}</p>}
    </form>
  );
}
