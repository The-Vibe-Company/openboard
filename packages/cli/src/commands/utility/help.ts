import type { Output } from "../../output.ts";
import { commandReference } from "../usage.ts";

const GROUPS = [
  ["Quick start", ["login", "connect", "use", "whoami", "help"]],
  ["Auth & boards", ["connections", "grants", "actors", "tokens"]],
  [
    "Messages & channels",
    [
      "channels",
      "read",
      "messages",
      "post",
      "posted",
      "reply",
      "edit",
      "delete",
      "label",
      "react",
      "wait",
      "tail",
      "download",
      "search",
    ],
  ],
  ["Tasks", ["tasks"]],
  ["Automation & schemas", ["schedule", "schedules", "webhooks", "inbound", "schemas"]],
  ["Admin & diagnostics", ["org", "audit", "doctor", "completion"]],
] as const;

export const utilityCommands = [
  {
    words: ["help"],
    usage: "ob help [command...]",
    summary: "Show help for a command.",
    example: "ob help tasks claim",
    options: [],
  },
  {
    words: ["doctor"],
    usage: "ob doctor [--json]",
    summary: "Check configuration, server readiness and authentication.",
    example: "ob doctor --json",
    options: [{ name: "--json", meaning: "Print structured diagnostics." }],
  },
  {
    words: ["completion"],
    usage: "ob completion <bash|zsh|fish>",
    summary: "Generate shell completions.",
    example: "ob completion zsh",
    options: [],
  },
] as const;

export function showHelp(output: Output, words: readonly string[]): number {
  const entries = [
    ...commandReference(),
    ...utilityCommands.map((entry) => ({ ...entry, command: `ob ${entry.words.join(" ")}` })),
  ];
  if (words.length > 0) {
    const entry = entries.find(({ command }) => command === `ob ${words.join(" ")}`);
    if (!entry) {
      output.err(`error: invalid_request: unknown command: ${words.join(" ")}`);
      return 2;
    }
    const options = entry.options.map(({ name, meaning }) => `  ${name}  ${meaning}`);
    output.out(entry.usage);
    output.out(entry.summary);
    output.out([...(options.length ? ["", "Options:", ...options] : []), "", `Example: ${entry.example}`].join("\n"));
    return 0;
  }
  const sections = new Map<string, string[]>(GROUPS.map(([title]) => [title, []]));
  for (const { command, summary } of entries.sort((a, b) => a.command.localeCompare(b.command))) {
    const root = command.split(" ")[1] ?? "";
    const group = GROUPS.find(([, roots]) => (roots as readonly string[]).includes(root))?.[0] ?? "Other commands";
    const lines = sections.get(group) ?? [];
    lines.push(`  ${command.slice(3).padEnd(22)}  ${summary}`);
    sections.set(group, lines);
  }
  output.out(
    [
      "Usage: ob <command> [options]",
      ...Array.from(sections, ([title, lines]) => [title, ...lines].join("\n")),
      "Use ob help <command> for details. Use ob --version to print the version.",
    ].join("\n\n"),
  );
  return 0;
}
