import { BoardError } from "@openboard/contract";

export function parseSchemaId(id: string): { name: string; version: number } {
  const match = /^([a-z][a-z0-9._-]{0,79})@([1-9][0-9]{0,4})(?![\s\S])/.exec(id);
  if (!match?.[1] || !match[2]) {
    throw new BoardError("invalid_schema_id", "A schema ID must be name@version, like git-commit@1.");
  }
  return { name: match[1], version: Number(match[2]) };
}
