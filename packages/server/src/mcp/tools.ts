import { type Operation, type OperationInput, operations } from "@openboard/contract";

/** Tool arguments use the same flat shape as the SDK's InputOf. */
function inputSchema({ params, query, body }: OperationInput) {
  const required = [...(params?.required ?? []), ...(query?.required ?? []), ...(body?.required ?? [])];
  return {
    type: "object",
    properties: { ...params?.properties, ...query?.properties, ...body?.properties },
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

export function listTools() {
  return operations.flatMap(({ mcp, summary, input, effects }: Operation) =>
    mcp
      ? [
          {
            name: mcp.tool,
            description: summary,
            inputSchema: inputSchema(input),
            annotations: {
              readOnlyHint: effects.readOnly,
              idempotentHint: effects.idempotent,
              destructiveHint: effects.emits.some((event) => /\.(deleted|revoked)$/.test(event)),
            },
          },
        ]
      : [],
  );
}
