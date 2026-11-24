import { expect, test } from "bun:test";
import { makeApp, PUBLIC_URL } from "./support/app.ts";

test("publishes the board's OpenAPI description without credentials or a tenant lookup", async () => {
  const app = makeApp();
  try {
    const response = await app.fetch(new Request(`${PUBLIC_URL}/api/local/main/openapi.json`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toStartWith("application/json");

    const document = await response.json();
    expect(document).toMatchObject({
      openapi: "3.1.0",
      paths: {
        "/": { get: { operationId: "discovery" } },
        "/channels": {
          post: {
            operationId: "createChannel",
            responses: {
              "200": { content: { "application/json": { schema: { type: "object" } } } },
              "201": { content: { "application/json": { schema: { type: "object" } } } },
              "429": {
                description: expect.stringContaining("rate_limited"),
                headers: { "retry-after": { schema: { type: "integer" } } },
              },
            },
          },
          get: {
            operationId: "channels",
            responses: {
              "401": {
                description: "unauthorized",
                content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } },
              },
              "404": { description: "not_found" },
            },
          },
        },
        "/events": { get: { operationId: "events" } },
        "/me": { get: { operationId: "me" } },
        "/messages": {
          get: { operationId: "channelMessages" },
          post: {
            operationId: "post",
            responses: { "201": { content: { "application/json": { schema: { type: "object" } } } } },
          },
        },
        "/messages/{id}": {
          get: {
            operationId: "message",
            parameters: [
              { name: "id", in: "path", required: true },
              { name: "after", in: "query", required: false },
              { name: "limit", in: "query", required: false },
            ],
          },
        },
        "/openapi.json": {
          get: { operationId: "openapi", security: [], responses: { "400": { description: "invalid_request" } } },
        },
      },
    });

    expect(document).toHaveProperty("paths./channels.get.responses.429.headers.retry-after.schema.type", "integer");

    expect(document).not.toHaveProperty("paths./api/x/auth/device/token.post.responses.429.headers");

    const unknown = await app.fetch(new Request(`${PUBLIC_URL}/api/nobody/nothing/openapi.json`));
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual(document);
  } finally {
    await app.close();
  }
});
