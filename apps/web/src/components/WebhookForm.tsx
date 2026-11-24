import { useBlocker } from "@tanstack/react-router";
import { BoardError, type Client } from "@the-vibe-company/openboard";
import { type FormEvent, useState } from "react";
import { webhookError, webhookRequest } from "../api/webhooks.ts";
import { Button, Card, Field, Input } from "../ui/index.ts";
import "./WebhookForm.css";

export function WebhookForm({
  create,
}: {
  create: (request: Parameters<Client["createWebhook"]>[0]) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  useBlocker({ shouldBlockFn: () => busy, enableBeforeUnload: false });
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
    <form onSubmit={submit}>
      <Card className="webhook-form">
        <fieldset disabled={busy}>
          <legend>Create a webhook</legend>
          <Field label="Name">{(props) => <Input {...props} name="name" required maxLength={100} />}</Field>
          <Field label="Receiver URL">
            {(props) => <Input {...props} name="url" type="url" required maxLength={4096} />}
          </Field>
          <Field label="Channel or tail" error={tailError && <span role="alert">{error.message}</span>}>
            {(props) => (
              <Input
                {...props}
                name="tail"
                maxLength={4096}
                placeholder="dev --label status=ready"
                onChange={() => tailError && setError(null)}
              />
            )}
          </Field>
          <Field label="Event types (comma-separated)" hint="Leave event types blank to include all matching events.">
            {(props) => <Input {...props} name="types" placeholder="labels.changed" />}
          </Field>
          <Button type="submit" pending={busy}>
            Create webhook
          </Button>
        </fieldset>
        {error != null && !tailError && <p role="alert">{webhookError(error, "Could not create the webhook.")}</p>}
      </Card>
    </form>
  );
}
