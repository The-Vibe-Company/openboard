import type { CommandMetadata } from "../index.ts";

export const shells = ["bash", "zsh", "fish"] as const;
type Shell = (typeof shells)[number];

/** Each command prefix maps to the next words a shell can complete. */
function candidates(commands: readonly CommandMetadata[]): Map<string, Set<string>> {
  const paths = commands.map(({ words }) => words);
  const tree = new Map<string, Set<string>>();
  for (const words of [
    ...paths,
    ...paths.map((path) => ["help", ...path]),
    ...shells.map((shell) => ["completion", shell]),
  ]) {
    for (const [index, word] of words.entries()) {
      const prefix = words.slice(0, index).join(" ");
      const choices = tree.get(prefix) ?? new Set();
      choices.add(word);
      tree.set(prefix, choices);
    }
  }
  return tree;
}

export function completion(shell: Shell, commands: readonly CommandMetadata[]): string {
  const tree = candidates(commands);
  if (shell === "fish") {
    return [
      "# Enable with: ob completion fish | source",
      "function __ob_matches",
      "    set -l tokens (commandline -opc)",
      '    set -l prefix (string join " " -- $tokens[2..-1])',
      '    test "$prefix" = "$argv[1]"',
      "end",
      ...Array.from(
        tree,
        ([prefix, choices]) => `complete -c ob -f -n "__ob_matches '${prefix}'" -a '${[...choices].join(" ")}'`,
      ),
    ].join("\n");
  }
  const cases = Array.from(tree, ([prefix, choices]) => `    '${prefix}') ob_choices=(${[...choices].join(" ")}) ;;`);
  return [
    `# Enable with: eval "$(ob completion ${shell})"`,
    ...(shell === "zsh" ? ["(( $+functions[compdef] )) || { autoload -Uz compinit; compinit; }"] : []),
    "_ob() {",
    "  local -a ob_choices",
    shell === "bash" ? `  case "\${COMP_WORDS[*]:1:COMP_CWORD-1}" in` : `  case "\${(j: :)words[2,CURRENT-1]}" in`,
    ...cases,
    "    *) return ;;",
    "  esac",
    shell === "bash"
      ? `  COMPREPLY=($(compgen -W "\${ob_choices[*]}" -- "\${COMP_WORDS[COMP_CWORD]}"))`
      : `  compadd -- "\${ob_choices[@]}"`,
    "}",
    shell === "bash" ? "complete -F _ob ob" : "compdef _ob ob",
  ].join("\n");
}
