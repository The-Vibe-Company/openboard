import type { createClient } from "@the-vibe-company/openboard";
import inboundSpec from "../inbound.json" with { type: "json" };

type Board = ReturnType<typeof createClient>;

export function createRunnerConnection(board: Board) {
  return board.createConnection({
    name: "remote-routine",
    can: { "work/fix/": ["read", "post", "label"] },
    profiles: ["run-*"],
    direct: false,
  });
}

export async function installInbound(board: Board, connection: string) {
  const spec = structuredClone(inboundSpec) as unknown as Parameters<Board["createInbound"]>[0];
  for (const rule of spec.rules) {
    for (const action of rule.do) {
      if ("agents.revoke" in action) action["agents.revoke"].connection = connection;
    }
  }
  const { inbound, secret } = await board.createInbound(spec);
  if (!secret) throw new Error("board did not generate an inbound signing secret");
  return { inbound, secret };
}
