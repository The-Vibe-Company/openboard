import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

function checkFrontMatter(markdown: string): string[] {
  const problems: string[] = [];
  const yaml = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)?.[1];
  let fields: { name?: unknown; description?: unknown } | undefined;
  try {
    const parsed: unknown = yaml === undefined ? undefined : Bun.YAML.parse(yaml);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fields = parsed;
  } catch {
    problems.push("front matter must be valid YAML");
  }
  if (fields?.name !== "openboard") problems.push("front matter must have name: openboard");
  const description = fields?.description;
  if (typeof description !== "string" || !description.trim() || [...description].length >= 1024) {
    problems.push("front matter must have a description under 1,024 characters");
  }
  const lineCount = markdown.replace(/\r?\n$/, "").split("\n").length;
  if (lineCount >= 500) problems.push("SKILL.md must be under 500 lines");
  return problems;
}

function readCommands(reference: string) {
  const sections = reference.split(/^## `(ob [^`]+)`[ \t]*\r?$/m);
  return sections.slice(1).flatMap((command, index) => {
    if (index % 2 !== 0) return [];
    const usage = sections[index + 2]?.match(/^```sh\r?\n([^\r\n]+)/m)?.[1] ?? "";
    const argument = usage.slice(command.length).trimStart();
    return [{ command, takesPositionals: /^(?:<|\[[^\s-])/.test(argument) }];
  });
}

function hasCommand(example: string, commands: ReturnType<typeof readCommands>): boolean {
  const invocation = example.trim().split(/\s+/).join(" ");
  return commands.some(({ command, takesPositionals }) => {
    if (invocation === command) return true;
    if (!invocation.startsWith(`${command} `)) return false;
    return takesPositionals || invocation.slice(command.length + 1).startsWith("-");
  });
}

export function checkSkillFile(
  path: string,
  markdown: string,
  reference: string,
  linkExists: (target: string) => boolean,
): string[] {
  const commands = readCommands(reference);
  const problems = path === "SKILL.md" ? checkFrontMatter(markdown).map((problem) => `${path}: ${problem}`) : [];
  const checkCommand = (example: string) => {
    if (path !== "references/commands.md" && /^ob\s/.test(example) && !hasCommand(example, commands)) {
      problems.push(`${path}: ob command is missing from references/commands.md`);
    }
  };
  Bun.markdown.render(markdown, {
    codespan(content) {
      checkCommand(content);
      return content;
    },
    code(content) {
      for (const line of content.split("\n")) checkCommand(line.trim().replace(/^\$ /, ""));
      return content;
    },
    link(content, { href }) {
      if (!/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href) && !linkExists(href)) {
        problems.push(`${path}: relative link target does not exist inside the skill`);
      }
      return content;
    },
  });
  markdown.split(/\r?\n/).forEach((line, index) => {
    if (/\bob[ctpl]_[A-Za-z0-9_-]+/i.test(line)) problems.push(`${path}:${index + 1}: credential-shaped string`);
  });
  return problems;
}

function hasHeading(markdown: string, anchor: string): boolean {
  const ids = new Set<string>();
  Bun.markdown.render(markdown, {
    heading(content) {
      const slug = content
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\p{M} _-]/gu, "")
        .replaceAll(" ", "-");
      let id = slug;
      for (let suffix = 1; ids.has(id); suffix++) id = `${slug}-${suffix}`;
      ids.add(id);
      return content;
    },
  });
  return ids.has(anchor);
}

function linkResolves(root: string, file: string, target: string): boolean {
  const [location = "", anchor] = target.split("#", 2);
  const [path = ""] = location.split("?", 1);
  try {
    const destination = realpathSync(path ? resolve(file, "..", decodeURIComponent(path)) : file);
    return (
      destination.startsWith(`${root}/`) &&
      (!anchor || hasHeading(readFileSync(destination, "utf8"), decodeURIComponent(anchor)))
    );
  } catch {
    return false;
  }
}

if (import.meta.main) {
  const root = realpathSync(resolve(import.meta.dir, "../../skills/openboard"));
  const reference = readFileSync(resolve(root, "references/commands.md"), "utf8");
  const paths = [...new Bun.Glob("**/*.md").scanSync({ cwd: root })].sort();
  if (!paths.includes("SKILL.md")) paths.unshift("SKILL.md");
  const problems = paths.flatMap((path) => {
    const file = resolve(root, path);
    return checkSkillFile(path, readFileSync(file, "utf8"), reference, (target) => linkResolves(root, file, target));
  });
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  if (problems.length > 0) process.exitCode = 1;
  else process.stdout.write(`OpenBoard skill checks passed (${paths.length} Markdown files)\n`);
}
