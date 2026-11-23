// Refuses module-level mutable state in `packages/*/src` and `apps/openboard/src`: a module-level
// `let` or `var`; a module-level `const` holding a `new …()`, array or object that the module or a
// file importing it changes in place; and a `static` class field that is not `readonly`, or is
// `readonly` but holds a container that is changed in place. Two apps in one process must share
// nothing (docs/codebase.md 3.2, 3.3 point 6, 5.6). Run by `bun run lint`. AST helpers:
// scripts/ci/module-state/ast.ts.
import { readFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { API } from "typescript/unstable/async";
import { type Node, NodeFlags, type SourceFile, SyntaxKind } from "typescript/unstable/ast";
import { childDirs, sourceFiles } from "./boundaries/workspaces.ts";
import { findMutation, hasModifier, lineOf, nameText, type Target, valueKind } from "./module-state/ast.ts";

export type Violation = { file: string; line: number; message: string };

const advice = "mutable state shared by every app in the process; move it into createApp or deps";

/** A value found in `file`: `exported` is the name other modules import it by, `member` the static field below it. */
type Owned = { file: string; node: Node; describe: string; local: string; member?: string; exported?: string } & Omit<
  Target,
  "path"
>;

type Parsed = { file: string; source: SourceFile };

function exportedNames(source: SourceFile): Map<string, string> {
  const names = new Map<string, string>();
  for (const statement of source.statements) {
    if (statement.kind !== SyntaxKind.ExportDeclaration || statement.moduleSpecifier) continue;
    if (statement.exportClause?.kind !== SyntaxKind.NamedExports) continue;
    for (const element of statement.exportClause.elements) {
      const local = nameText(element.propertyName ?? element.name);
      const exported = nameText(element.name);
      if (local && exported) names.set(local, exported);
    }
  }
  return names;
}

function exportName(statement: Node, local: string, named: Map<string, string>): string | undefined {
  return hasModifier(statement, SyntaxKind.ExportKeyword) ? local : named.get(local);
}

function moduleVariables(file: string, source: SourceFile, violations: Violation[], owned: Owned[]): void {
  const named = exportedNames(source);
  for (const statement of source.statements) {
    if (statement.kind !== SyntaxKind.VariableStatement || hasModifier(statement, SyntaxKind.DeclareKeyword)) continue;
    const list = statement.declarationList;
    const keyword = list.flags & NodeFlags.Let ? "let" : list.flags & (NodeFlags.Const | NodeFlags.Using) ? "" : "var";
    for (const declaration of list.declarations) {
      const kind = valueKind(declaration.initializer);
      if (keyword) {
        violations.push({
          file,
          line: lineOf(source, declaration),
          message: `module-level \`${keyword}\` is ${advice}`,
        });
      } else if (declaration.name.kind === SyntaxKind.Identifier && kind) {
        const local = declaration.name.text;
        const exported = exportName(statement, local, named);
        owned.push({
          file,
          node: declaration,
          describe: `module-level \`${local}\``,
          local,
          exported,
          container: kind === "container",
        });
      }
    }
  }
}

function staticFields(file: string, source: SourceFile, violations: Violation[], owned: Owned[]): void {
  const named = exportedNames(source);
  const visit = (node: Node): undefined => {
    if (node.kind === SyntaxKind.ClassDeclaration || node.kind === SyntaxKind.ClassExpression) {
      const className = node.name ? nameText(node.name) : undefined;
      const topLevel = node.kind === SyntaxKind.ClassDeclaration && node.parent === source;
      const exported = topLevel && className ? exportName(node, className, named) : undefined;
      for (const member of node.members) {
        if (member.kind !== SyntaxKind.PropertyDeclaration || !hasModifier(member, SyntaxKind.StaticKeyword)) continue;
        if (hasModifier(member, SyntaxKind.DeclareKeyword)) continue;
        const field = nameText(member.name) ?? "[computed]";
        const kind = valueKind(member.initializer);
        if (!hasModifier(member, SyntaxKind.ReadonlyKeyword)) {
          violations.push({
            file,
            line: lineOf(source, member),
            message: `static field \`${field}\` is not readonly: ${advice}`,
          });
        } else if (kind && nameText(member.name)) {
          const base = { file, node: member, describe: `static field \`${field}\``, member: field, owner: node };
          owned.push({ ...base, local: className ?? "", exported, container: kind === "container" });
        }
      }
    }
    node.forEachChild(visit);
    return undefined;
  };
  source.forEachChild(visit);
}

/** Paths that reach `value` inside its own file. */
function localPaths(value: Owned): string[][] {
  if (value.member === undefined) return [[value.local]];
  return value.local
    ? [
        [value.local, value.member],
        ["this", value.member],
      ]
    : [["this", value.member]];
}

/** Paths that reach `value` from `importer`, through a named or namespace import of its module. */
function importedPaths(value: Owned, importer: SourceFile, resolvesTo: (specifier: string) => boolean): string[][] {
  if (!value.exported) return [];
  const rest = value.member === undefined ? [] : [value.member];
  const paths: string[][] = [];
  for (const statement of importer.statements) {
    if (statement.kind !== SyntaxKind.ImportDeclaration || statement.moduleSpecifier.kind !== SyntaxKind.StringLiteral)
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !resolvesTo(statement.moduleSpecifier.text)) continue;
    if (bindings.kind === SyntaxKind.NamespaceImport) paths.push([bindings.name.text, value.exported, ...rest]);
    else {
      for (const element of bindings.elements) {
        if (nameText(element.propertyName ?? element.name) === value.exported) paths.push([element.name.text, ...rest]);
      }
    }
  }
  return paths;
}

/** Whether an import `specifier` in `importer` can name `target` (relative path, or the package that owns it). */
export function specifierResolves(
  importer: string,
  specifier: string,
  target: string,
  packages: Map<string, string>,
): boolean {
  const stem = (path: string) => path.replace(/\.(?:[cm]?[jt]sx?)$/, "").replace(/\/index$/, "");
  if (specifier.startsWith(".")) return stem(posix.join(dirname(importer), specifier)) === stem(target);
  for (const [name, dir] of packages) {
    if ((specifier === name || specifier.startsWith(`${name}/`)) && target.startsWith(`${dir}/src/`)) return true;
  }
  return false;
}

/** Every module-level mutable state violation across the parsed files. */
export function checkSources(parsed: Parsed[], packages: Map<string, string> = new Map()): Violation[] {
  const violations: Violation[] = [];
  const owned: Owned[] = [];
  for (const { file, source } of parsed) {
    moduleVariables(file, source, violations, owned);
    staticFields(file, source, violations, owned);
  }
  for (const value of owned) {
    const home = parsed.find(({ file }) => file === value.file);
    if (!home) continue;
    let where: string | undefined;
    for (const { file, source } of [home, ...parsed.filter((other) => other !== home)]) {
      const paths =
        file === value.file
          ? localPaths(value)
          : importedPaths(value, source, (specifier) => specifierResolves(file, specifier, value.file, packages));
      const [mutation] = paths
        .map((path) => findMutation(source, { ...value, path }))
        .filter((node) => node !== undefined)
        .sort((a, b) => a.pos - b.pos);
      if (mutation) {
        const line = lineOf(source, mutation);
        where = file === value.file ? `line ${line}` : `${file}:${line}`;
        break;
      }
    }
    if (where) {
      violations.push({
        file: value.file,
        line: lineOf(home.source, value.node),
        message: `${value.describe} is mutated at ${where}: ${advice}`,
      });
    }
  }
  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** The files the rule covers under `root`: every `packages/<name>/src` and `apps/openboard/src`. */
export async function checkedFiles(root: string): Promise<string[]> {
  const dirs = [...(await childDirs(root, "packages")).map((dir) => `${dir}/src`), "apps/openboard/src"];
  const files = await Promise.all(dirs.map((dir) => sourceFiles(root, dir).catch(() => [])));
  return files.flat().filter((file) => !file.endsWith(".d.ts"));
}

/** Package name to directory, for `packages/*` with a manifest. */
async function packageNames(root: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const dir of await childDirs(root, "packages")) {
    const text = await readFile(join(root, dir, "package.json"), "utf8").catch(() => null);
    const name = text === null ? undefined : (JSON.parse(text) as { name?: unknown }).name;
    if (typeof name === "string") names.set(name, dir);
  }
  return names;
}

export async function checkModuleState(root: string): Promise<Violation[]> {
  const files = await checkedFiles(root);
  if (files.length === 0) return [];
  const parsed: Parsed[] = [];
  const violations: Violation[] = [];
  const api = new API({ cwd: root });
  try {
    const snapshot = await api.updateSnapshot({ openFiles: files.map((file) => resolve(root, file)) });
    for (const file of files) {
      const path = resolve(root, file);
      const project = await snapshot.getDefaultProjectForFile(path);
      const source = await project?.program.getSourceFile(path);
      if (source) parsed.push({ file, source });
      else violations.push({ file, line: 1, message: "cannot parse source to check module-level state" });
    }
    return [...violations, ...checkSources(parsed, await packageNames(root))];
  } finally {
    await api.close();
  }
}

if (import.meta.main) {
  const violations = await checkModuleState(join(import.meta.dir, "..", ".."));
  for (const { file, line, message } of violations) console.error(`${file}:${line}: ${message}`);
  if (violations.length > 0) {
    console.error(`module-state: ${violations.length} violation(s) (docs/codebase.md 3.2, 5.6)`);
    process.exit(1);
  }
  console.log("module-state: no module-level mutable state");
}
