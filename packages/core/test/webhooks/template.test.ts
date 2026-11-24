import { expect, test } from "bun:test";
import { WebhookEventPayloadV1 } from "@openboard/contract";
import { renderWebhookTemplate, validateWebhookTemplate } from "../../src/webhooks/template.ts";

const payload = {
  subject: { thread: "2", labels: { status: "ready" } },
  delivery: { id: "dl_example", attempt: 1 },
  board: { url: "http://localhost/api/local/main" },
};

function render(template: object, data: object = payload): unknown {
  const result = renderWebhookTemplate(template, data, 256 * 1024);
  if (result === null) throw new Error("expected JSON");
  return JSON.parse(result);
}

test("renders JSON values and interpolates surrounding text", () => {
  expect(
    render({
      externalRef: "ob:{{subject.thread}}",
      idempotencyKey: "{{delivery.id}}",
      input: { board: "{{board.url}}", labels: "{{subject.labels}}", n: "{{delivery.attempt}}" },
    }),
  ).toEqual({
    externalRef: "ob:2",
    idempotencyKey: "dl_example",
    input: { board: payload.board.url, labels: { status: "ready" }, n: 1 },
  });
});

test("renders missing paths as null or empty text and ignores inherited properties", () => {
  expect(render(["{{subject.missing}}", "a{{subject.missing}}b", "{{subject.constructor}}"])).toEqual([
    null,
    "ab",
    null,
  ]);
});

test("substitutes paths only in template values and copies resolved data literally", () => {
  const data = { ...payload, values: ['"{{subject.thread}}"\n', false] };
  expect(
    render(
      {
        "{{delivery.id}}": ["{{values}}", "{{values.0}}", "{{values.1}}", "x{{delivery.attempt}}/{{subject.thread}}"],
        expressions: ["{{delivery.attempt + 1}}", "{{subject.thread|upper}}", "{{subject.thread.toString()}}"],
      },
      data,
    ),
  ).toEqual({
    "{{delivery.id}}": [data.values, data.values[0], false, "x1/2"],
    expressions: ["{{delivery.attempt + 1}}", "{{subject.thread|upper}}", "{{subject.thread.toString()}}"],
  });
});

test("counts UTF-8 bytes after rendering", () => {
  const template = ["x{{value}}y"];
  const data = { value: "𐐷".repeat(2) };
  const expected = JSON.stringify(["x𐐷𐐷y"]);
  const bytes = new TextEncoder().encode(expected).length;
  expect(renderWebhookTemplate(template, data, bytes)).toBe(expected);
  expect(renderWebhookTemplate(template, data, bytes - 1)).toBeNull();
});

test("validates template paths from the TypeBox payload and message schemas", () => {
  const schema = WebhookEventPayloadV1.properties;
  const paths = [
    ...Object.keys(schema),
    ...Object.keys(schema.subject.properties).map((key) => `subject.${key}`),
    ...Object.keys(schema.event.properties.message.properties).map((key) => `event.message.${key}`),
    "subject.task.state",
    "subject.schedule.n",
    "event.message.author.via.name",
    "event.message.mentions.0.actor.handle",
    "event.message.reactions.thumbs-up.0",
    "event.payload.custom.0.nested",
    "subject.labels.next-state",
  ];
  expect(() => validateWebhookTemplate(paths.map((path) => `{{${path}}}`))).not.toThrow();
  expect(() => validateWebhookTemplate(["{{event.message.mentions.length}}"])).toThrow(
    /closest valid path is "event.message.mentions"/,
  );
  expect(() => validateWebhookTemplate(["{{subject.constructor}}"])).toThrow(/unknown webhook template path/);
});

test("validates only string values and rejects unmatched openings", () => {
  expect(() =>
    validateWebhookTemplate({
      "{{unknown": ["{{subject.thread}}", "{{delivery.attempt + 1}}", "{{{{subject.thread}}}}"],
    }),
  ).not.toThrow();
  expect(() => validateWebhookTemplate(["{{unknown {{subject.thread}}"])).toThrow(/unclosed \{\{/);
});
