import { expect, test } from "bun:test";
import { webhookRequest } from "../src/api/webhooks.ts";

test("builds a webhook request from a tail and comma-separated event types", () => {
  const form = new FormData();
  form.set("name", " dev-ready ");
  form.set("url", " http://localhost:8080/hooks ");
  form.set("tail", " dev --label status=ready ");
  form.set("types", " labels.changed, , message.posted ");
  expect(webhookRequest(form)).toEqual({
    name: "dev-ready",
    url: "http://localhost:8080/hooks",
    filter: { tail: "dev --label status=ready", types: ["labels.changed", "message.posted"] },
  });
});

test("a channel works as a tail and blank event types omit the type filter", () => {
  const form = new FormData();
  form.set("tail", "dev");
  form.set("types", " ");
  expect(webhookRequest(form).filter).toEqual({ tail: "dev" });
});
