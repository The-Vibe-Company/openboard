// AST helpers for scripts/ci/module-state.ts: which module-level values are mutable, and where a
// file changes one in place. Names are resolved lexically: a parameter or local declaration with the
// same name shadows the module value, and `this` reaches a static field only inside a static member
// of the class that declares it.
import { type Expression, type Node, type SourceFile, SyntaxKind } from "typescript/unstable/ast";

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

/**
 * A module-level value that must not be changed in place. `path` is the access chain that reaches it
 * in the file being searched (`["cache"]`, `["Registry", "items"]`, `["this", "items"]`).
 * `container` is true for `new …()` and arrays, whose mutating methods count; object literals only
 * count assignment, `delete` and `Object.assign`. `owner` is the class for static fields.
 */
export type Target = { path: string[]; container: boolean; owner?: Node };

export type ValueKind = "container" | "object" | undefined;

export function lineOf(source: SourceFile, node: Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

export function hasModifier(node: Node, kind: SyntaxKind): boolean {
  const modifiers = (node as { modifiers?: readonly Node[] }).modifiers;
  return modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

export function unwrap(node: Node): Node {
  let current = node;
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
        return current;
    }
  }
}

export function valueKind(initializer: Expression | undefined): ValueKind {
  if (!initializer) return undefined;
  const kind = unwrap(initializer).kind;
  if (kind === SyntaxKind.NewExpression || kind === SyntaxKind.ArrayLiteralExpression) return "container";
  return kind === SyntaxKind.ObjectLiteralExpression ? "object" : undefined;
}

/** The text of an identifier or `#private` name, or undefined for a computed name. */
export function nameText(node: Node): string | undefined {
  return node.kind === SyntaxKind.Identifier || node.kind === SyntaxKind.PrivateIdentifier ? node.text : undefined;
}

type Chain = { parts: string[]; root: Node };

/** The access chain of `a.b[c].d` as `["a", "b", "*", "d"]` with its root node, when it starts at a name or `this`. */
function chainOf(node: Node): Chain | undefined {
  const current = unwrap(node);
  switch (current.kind) {
    case SyntaxKind.Identifier:
      return { parts: [current.text], root: current };
    case SyntaxKind.ThisKeyword:
      return { parts: ["this"], root: current };
    case SyntaxKind.PropertyAccessExpression: {
      const base = chainOf(current.expression);
      return base && { parts: [...base.parts, nameText(current.name) ?? "*"], root: base.root };
    }
    case SyntaxKind.ElementAccessExpression: {
      const base = chainOf(current.expression);
      return base && { parts: [...base.parts, "*"], root: base.root };
    }
    default:
      return undefined;
  }
}

/** Names a binding (`a`, `{ a, b: [c] }`) introduces. */
function bindingNames(node: Node | undefined, names: string[]): string[] {
  if (!node) return names;
  if (node.kind === SyntaxKind.Identifier) names.push(node.text);
  else if (node.kind === SyntaxKind.ObjectBindingPattern || node.kind === SyntaxKind.ArrayBindingPattern) {
    for (const element of node.elements)
      if (element.kind === SyntaxKind.BindingElement) bindingNames(element.name, names);
  }
  return names;
}

function statementNames(statement: Node, names: string[]): void {
  switch (statement.kind) {
    case SyntaxKind.VariableStatement:
      for (const declaration of statement.declarationList.declarations) bindingNames(declaration.name, names);
      break;
    case SyntaxKind.FunctionDeclaration:
    case SyntaxKind.ClassDeclaration:
    case SyntaxKind.EnumDeclaration:
      if (statement.name) bindingNames(statement.name, names);
      break;
  }
}

/** Names `scope` declares for the code inside it, other than the target's own class. */
function declaredNames(scope: Node): string[] {
  const names: string[] = [];
  const parameters = (scope as { parameters?: readonly Node[] }).parameters;
  if (parameters && scope.kind !== SyntaxKind.FunctionType && scope.kind !== SyntaxKind.ConstructorType) {
    for (const parameter of parameters)
      if (parameter.kind === SyntaxKind.Parameter) bindingNames(parameter.name, names);
  }
  if (scope.kind === SyntaxKind.FunctionExpression && scope.name) names.push(scope.name.text);
  const statements = (scope as { statements?: readonly Node[] }).statements;
  if (statements && scope.kind !== SyntaxKind.SourceFile)
    for (const statement of statements) statementNames(statement, names);
  switch (scope.kind) {
    case SyntaxKind.ForStatement:
    case SyntaxKind.ForInStatement:
    case SyntaxKind.ForOfStatement:
      if (scope.initializer?.kind === SyntaxKind.VariableDeclarationList) {
        for (const declaration of scope.initializer.declarations) bindingNames(declaration.name, names);
      }
      break;
    case SyntaxKind.CatchClause:
      bindingNames(scope.variableDeclaration?.name, names);
      break;
  }
  return names;
}

/** True when `name` at `node` refers to something other than the module-level binding. */
function isShadowed(node: Node, name: string, owner: Node | undefined): boolean {
  for (let scope = node.parent; scope && scope.kind !== SyntaxKind.SourceFile; scope = scope.parent) {
    if (!declaredNames(scope).includes(name)) continue;
    const ownerName = owner && "name" in owner ? (owner.name as Node | undefined) : undefined;
    if (owner && ownerName && nameText(ownerName) === name && owner.parent === scope) continue;
    return true;
  }
  return false;
}

/** True when `this` at `node` is the class `owner` itself: inside one of its static members or static blocks. */
function isStaticThis(node: Node, owner: Node | undefined): boolean {
  for (let scope = node.parent; scope; scope = scope.parent) {
    switch (scope.kind) {
      case SyntaxKind.ArrowFunction:
        continue;
      case SyntaxKind.ClassStaticBlockDeclaration:
        return scope.parent === owner;
      case SyntaxKind.MethodDeclaration:
      case SyntaxKind.GetAccessor:
      case SyntaxKind.SetAccessor:
      case SyntaxKind.PropertyDeclaration:
        return scope.parent === owner && hasModifier(scope, SyntaxKind.StaticKeyword);
      case SyntaxKind.Constructor:
      case SyntaxKind.FunctionDeclaration:
      case SyntaxKind.FunctionExpression:
      case SyntaxKind.ClassDeclaration:
      case SyntaxKind.ClassExpression:
      case SyntaxKind.SourceFile:
        return false;
    }
  }
  return false;
}

/** True when `node` reaches the target (`inclusive`) or something inside it, through the module-level binding. */
function reaches(node: Node, target: Target, inclusive: boolean): boolean {
  const chain = chainOf(node);
  if (!chain || chain.parts.length < target.path.length + (inclusive ? 0 : 1)) return false;
  if (!target.path.every((part, index) => chain.parts[index] === part)) return false;
  const [head = ""] = target.path;
  return head === "this" ? isStaticThis(chain.root, target.owner) : !isShadowed(chain.root, head, target.owner);
}

function isAssignment(kind: SyntaxKind): boolean {
  return kind >= SyntaxKind.FirstAssignment && kind <= SyntaxKind.LastAssignment;
}

function mutates(node: Node, target: Target): boolean {
  switch (node.kind) {
    case SyntaxKind.BinaryExpression:
      return isAssignment(node.operatorToken.kind) && reaches(node.left, target, false);
    case SyntaxKind.PrefixUnaryExpression:
    case SyntaxKind.PostfixUnaryExpression:
      return (
        (node.operator === SyntaxKind.PlusPlusToken || node.operator === SyntaxKind.MinusMinusToken) &&
        reaches(node.operand, target, false)
      );
    case SyntaxKind.DeleteExpression:
      return reaches(node.expression, target, false);
    case SyntaxKind.CallExpression: {
      const callee = unwrap(node.expression);
      if (callee.kind !== SyntaxKind.PropertyAccessExpression) return false;
      const method = nameText(callee.name);
      const object = unwrap(callee.expression);
      const [first] = node.arguments;
      if (method === "assign" && object.kind === SyntaxKind.Identifier && object.text === "Object" && first) {
        return reaches(first, target, true);
      }
      if (!method || !mutatingMethods.has(method)) return false;
      // Methods count on the container itself, and on anything reached inside it.
      return reaches(callee.expression, target, target.container);
    }
    default:
      return false;
  }
}

/** The first node in `source` that changes the target in place, if any. */
export function findMutation(source: SourceFile, target: Target): Node | undefined {
  let found: Node | undefined;
  const visit = (node: Node): undefined => {
    if (found) return undefined;
    if (mutates(node, target)) found = node;
    else node.forEachChild(visit);
    return undefined;
  };
  source.forEachChild(visit);
  return found;
}
