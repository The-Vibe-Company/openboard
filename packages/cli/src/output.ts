import type { BoardError } from "@the-vibe-company/openboard";

/** Where the CLI writes; tests hand in their own. */
export interface Output {
  out(line: string): void;
  err(line: string): void;
}

export const consoleOutput: Output = Object.freeze({
  out: (line: string) => console.log(line),
  err: (line: string) => console.error(line),
});

/** A board error as upstream's CLI prints it: `error: ` and the message, then its hint two spaces in. */
export function printError(output: Output, error: BoardError): void {
  output.err(`error: ${error.message}`);
  if (error.hint) output.err(`  ${error.hint}`);
}

/** A message on one line: its ID, then the first line of its text. */
export function messageLine(message: { readonly id: string; readonly text: string }): string {
  const [first = "", ...rest] = message.text.trim().split(/\r?\n/);
  return `#${message.id}  ${first.trimEnd()}${rest.length > 0 ? " …" : ""}`;
}

/** How a derived command prints its operation's answer without `--json`; raw JSON for one not listed. */
export const formats: Readonly<Record<string, (output: unknown) => string>> = Object.freeze({
  postMessage: (output: unknown) => (output as { message: { id: string } }).message.id,
});
