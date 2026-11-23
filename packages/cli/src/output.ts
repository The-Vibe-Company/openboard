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

function shellArg(arg: string): string {
  return /^[\w./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\"'\"'")}'`;
}

/** A board error followed by the board's recovery guidance when supplied. */
export function printError(output: Output, error: BoardError): void {
  const next = error.code === "invalid_request" ? error.next : undefined;
  output.err(`${next?.length ? "error: " : ""}${error.code}: ${error.message}`);
  if (error.hint) output.err(error.hint);
  for (const step of next ?? []) {
    if (step.kind === "run" && step.argv.every((arg) => !/[\p{Cc}\p{Cf}]/u.test(arg))) {
      output.err(`next: ${step.argv.map(shellArg).join(" ")}`);
    }
  }
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
