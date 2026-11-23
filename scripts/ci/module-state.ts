// Refuses module-level mutable state in `packages/*/src` and `apps/openboard/src`: a module-level
// `let` or `var`, a module-level `const` holding a `new …()`, array or object literal that the same
// file later mutates, and a `static` class field that is not `readonly` (or is `readonly` but holds
// a container the class mutates). Two apps in one process must share nothing (docs/codebase.md 3.2,
// 3.3 point 6, 5.6). Run by `bun run lint`.
import { join, resolve } from "node:path";
import { API } from "typescript/unstable/async";
import { type Expression, type Node, NodeFlags, type SourceFile, SyntaxKind } from "typescript/unstable/ast";
import { childDirs, sourceFiles } from "./boundaries/workspaces.ts";

export type Violation = { file: string; line: number; message: string };

/** Method names that change a Map, Set, WeakMap, WeakSet or array in place. */
const mutatingMethods = new Set([
  "set",
  "add",
  "delete",
  "clear",
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
]);

/** A tracked value: the access path that reaches it (`["cache"]`, `["Registry", "items"]`, `["this", "items"]`). */
type Target = { path: string[]; node: Node; describe: string };

function lineOf(source: SourceFile, node: Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function hasModifier(node: Node, kind: SyntaxKind): boolean {
  const modifiers = (node as { modifiers?: readonly Node[] }).modifiers;
  return modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function unwrap(node: Expression): Expression {
  let current: Node = node;
  for (;;) {
    switch (current.kind) {
      case SyntaxKind.ParenthesizedExpression:
      case SyntaxKind.AsExpression:
      case SyntaxKind.SatisfiesExpression:
      case SyntaxKind.TypeAssertionExpression:
      case SyntaxKind.NonNullExpression:
        current = current.expression;
        break;
      default:
        return current as Expression;
    }
  }
}

function isMutableValue(initializer: Expression | undefined): boolean {
  if (!initializer) return false;
  const kind = unwrap(initializer).kind;
  return (
    kind === SyntaxKind.NewExpression ||
    kind === SyntaxKind.ArrayLiteralExpression ||
    kind === SyntaxKind.ObjectLiteralExpression
  );
}

/** The access chain of `a.b[c].d` as `["a", "b", "*", "d"]`, or undefined when it does not start at a name or `this`. */
function chainOf(node: Node): string[] | undefined {
  const node2 = unwrap(node as Expression);
  switch (node2.kind) {
    case SyntaxKind.Identifier:
      return [node2.text];
    case SyntaxKind.ThisKeyword:
      return ["this"];
    case SyntaxKind.PropertyAccessExpression: {
      const base = chainOf(node2.expression);
      return base && node2.name.kind === SyntaxKind.Identifier ? [...base, node2.name.text] : base && [...base, "*"];
    }
    case SyntaxKind.ElementAccessExpression: {
      const base = chainOf(node2.expression);
      return base && [...base, "*"];
    }
    default:
      return undefined;
  }
}

/** True when `chain` reaches into the target (strictly longer than its path, same prefix). */
function reachesInto(chain: string[] | undefined, target: Target, inclusive = false): boolean {
  if (!chain || chain.length < target.path.length + (inclusive ? 0 : 1)) return false;
  return target.path.every((part, index) => chain[index] === part);
}

function isAssignment(kind: SyntaxKind): boolean {
  return kind >= SyntaxKind.FirstAssignment && kind <= SyntaxKind.LastAssignment;
}

/** The first node in `source` that changes the target in place, if any. */
function findMutation(source: SourceFile, target: Target): Node | undefined {
  let found: Node | undefined;
  const visit = (node: Node): undefined => {
    if (found) return undefined;
    switch (node.kind) {
      case SyntaxKind.BinaryExpression:
        if (isAssignment(node.operatorToken.kind) && reachesInto(chainOf(node.left), target)) found = node;
        break;
      case SyntaxKind.PrefixUnaryExpression:
      case SyntaxKind.PostfixUnaryExpression:
        if (
          (node.operator === SyntaxKind.PlusPlusToken || node.operator === SyntaxKind.MinusMinusToken) &&
          reachesInto(chainOf(node.operand), target)
        )
          found = node;
        break;
      case SyntaxKind.DeleteExpression:
        if (reachesInto(chainOf(node.expression), target)) found = node;
        break;
      case SyntaxKind.CallExpression: {
        const callee = unwrap(node.expression);
        if (
          callee.kind === SyntaxKind.PropertyAccessExpression &&
          callee.name.kind === SyntaxKind.Identifier &&
          mutatingMethods.has(callee.name.text) &&
          reachesInto(chainOf(callee.expression), target, true)
        )
          found = node;
        const [first] = node.arguments;
        if (chainOf(callee)?.join(".") === "Object.assign" && first && reachesInto(chainOf(first), target, true))
          found = node;
        break;
      }
    }
    if (!found) node.forEachChild(visit);
    return undefined;
  };
  source.forEachChild(visit);
  return found;
}

function moduleVariables(source: SourceFile, violations: Violation[], file: string, targets: Target[]): void {
  for (const statement of source.statements) {
    if (statement.kind !== SyntaxKind.VariableStatement || hasModifier(statement, SyntaxKind.DeclareKeyword)) continue;
    const list = statement.declarationList;
    const keyword = list.flags & NodeFlags.Let ? "let" : list.flags & (NodeFlags.Const | NodeFlags.Using) ? "" : "var";
    for (const declaration of list.declarations) {
      if (keyword) {
        violations.push({
          file,
          line: lineOf(source, declaration),
          message: `module-level \`${keyword}\` is mutable state shared by every app in the process; move it into createApp or deps`,
        });
      } else if (declaration.name.kind === SyntaxKind.Identifier && isMutableValue(declaration.initializer)) {
        const name = declaration.name.text;
        targets.push({ path: [name], node: declaration, describe: `module-level \`${name}\`` });
      }
    }
  }
}

function staticFields(source: SourceFile, violations: Violation[], file: string, targets: Target[]): void {
  const visit = (node: Node): undefined => {
    if (node.kind === SyntaxKind.ClassDeclaration || node.kind === SyntaxKind.ClassExpression) {
      const className = node.name?.kind === SyntaxKind.Identifier ? node.name.text : undefined;
      for (const member of node.members) {
        if (member.kind !== SyntaxKind.PropertyDeclaration || !hasModifier(member, SyntaxKind.StaticKeyword)) continue;
        if (hasModifier(member, SyntaxKind.DeclareKeyword)) continue;
        const field = member.name.kind === SyntaxKind.Identifier ? member.name.text : "*";
        if (!hasModifier(member, SyntaxKind.ReadonlyKeyword)) {
          violations.push({
            file,
            line: lineOf(source, member),
            message: `static field \`${field}\` is not readonly: mutable state shared by every app in the process; make it an instance field or readonly`,
          });
        } else if (isMutableValue(member.initializer)) {
          const describe = `static field \`${field}\``;
          if (className) targets.push({ path: [className, field], node: member, describe });
          targets.push({ path: ["this", field], node: member, describe });
        }
      }
    }
    node.forEachChild(visit);
    return undefined;
  };
  source.forEachChild(visit);
}

/** Every module-level mutable state violation in one parsed file. */
export function checkSource(file: string, source: SourceFile): Violation[] {
  const violations: Violation[] = [];
  const targets: Target[] = [];
  moduleVariables(source, violations, file, targets);
  staticFields(source, violations, file, targets);
  const reported = new Set<Node>();
  for (const target of targets) {
    if (reported.has(target.node)) continue;
    const mutation = findMutation(source, target);
    if (!mutation) continue;
    reported.add(target.node);
    violations.push({
      file,
      line: lineOf(source, target.node),
      message: `${target.describe} is mutated at line ${lineOf(source, mutation)}: mutable state shared by every app in the process; move it into createApp or deps`,
    });
  }
  return violations.sort((a, b) => a.line - b.line);
}

/** The source directories the rule covers under `root`: every `packages/<name>/src` and `apps/openboard/src`. */
export async function checkedFiles(root: string): Promise<string[]> {
  const dirs = [...(await childDirs(root, "packages")).map((dir) => `${dir}/src`), "apps/openboard/src"];
  const files = await Promise.all(dirs.map((dir) => sourceFiles(root, dir).catch(() => [])));
  return files.flat().filter((file) => !file.endsWith(".d.ts"));
}

export async function checkModuleState(root: string): Promise<Violation[]> {
  const files = await checkedFiles(root);
  if (files.length === 0) return [];
  const violations: Violation[] = [];
  const api = new API({ cwd: root });
  try {
    const snapshot = await api.updateSnapshot({ openFiles: files.map((file) => resolve(root, file)) });
    for (const file of files) {
      const path = resolve(root, file);
      const project = await snapshot.getDefaultProjectForFile(path);
      const source = await project?.program.getSourceFile(path);
      if (source) violations.push(...checkSource(file, source));
      else violations.push({ file, line: 1, message: "cannot parse source to check module-level state" });
    }
  } finally {
    await api.close();
  }
  return violations;
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
