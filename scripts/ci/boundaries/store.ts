import { resolve } from "node:path";
import { type Node, type SourceFile, SyntaxKind } from "typescript/unstable/ast";
import { API } from "typescript/unstable/async";
import type { Violation } from "./types.ts";
import { sourceFiles, type Workspace } from "./workspaces.ts";

const server = "packages/server";
const app = `${server}/src/app.ts`;
const scope = `${server}/src/http/scope.ts`;

function isPorts(node: Node | undefined): boolean {
  return node?.kind === SyntaxKind.StringLiteral && node.text === "@openboard/ports";
}

function firstStoreAccess(source: SourceFile): Node | undefined {
  const namespaces = new Set<string>();
  for (const node of source.statements) {
    if (node.kind === SyntaxKind.ImportDeclaration && isPorts(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings;
      if (bindings?.kind === SyntaxKind.NamespaceImport) namespaces.add(bindings.name.text);
    }
    if (node.kind === SyntaxKind.ImportEqualsDeclaration) {
      const ref = node.moduleReference;
      if (ref.kind === SyntaxKind.ExternalModuleReference && isPorts(ref.expression)) namespaces.add(node.name.text);
    }
  }

  const visit = (node: Node): Node | undefined => {
    switch (node.kind) {
      case SyntaxKind.ImportDeclaration: {
        if (!isPorts(node.moduleSpecifier)) break;
        const bindings = node.importClause?.namedBindings;
        if (bindings?.kind === SyntaxKind.NamedImports) {
          return bindings.elements.find((entry) => (entry.propertyName ?? entry.name).text === "Store");
        }
        break;
      }
      case SyntaxKind.ExportDeclaration: {
        if (!isPorts(node.moduleSpecifier)) break;
        const clause = node.exportClause;
        if (clause?.kind !== SyntaxKind.NamedExports) return node;
        return clause.elements.find((entry) => (entry.propertyName ?? entry.name).text === "Store");
      }
      case SyntaxKind.ImportType:
        if (
          node.argument.kind === SyntaxKind.LiteralType &&
          isPorts(node.argument.literal) &&
          node.qualifier?.kind === SyntaxKind.Identifier &&
          node.qualifier.text === "Store"
        ) {
          return node;
        }
        break;
      case SyntaxKind.ExpressionWithTypeArguments: {
        // Type heritage clauses represent a namespace member as a property access.
        const expression = node.expression;
        if (
          expression.kind === SyntaxKind.PropertyAccessExpression &&
          expression.expression.kind === SyntaxKind.Identifier &&
          namespaces.has(expression.expression.text) &&
          expression.name.text === "Store"
        ) {
          return expression;
        }
        break;
      }
      case SyntaxKind.QualifiedName:
        if (node.left.kind === SyntaxKind.Identifier && namespaces.has(node.left.text) && node.right.text === "Store") {
          return node;
        }
        break;
    }
    return node.forEachChild(visit);
  };
  return source.forEachChild(visit);
}

/** Only app wiring and scope resolution may name the unscoped Store in server source (docs/codebase.md 3.2). */
export async function checkStore(root: string, workspaces: Workspace[]): Promise<Violation[]> {
  if (!workspaces.some(({ dir }) => dir === server)) return [];
  const files = (await sourceFiles(root, server)).filter(
    (file) => file.startsWith(`${server}/src/`) && file !== app && file !== scope,
  );
  if (files.length === 0) return [];

  const api = new API({ cwd: root });
  try {
    const snapshot = await api.updateSnapshot({ openFiles: files.map((file) => resolve(root, file)) });
    const violations: Violation[] = [];
    for (const file of files) {
      const path = resolve(root, file);
      const project = await snapshot.getDefaultProjectForFile(path);
      const source = await project?.program.getSourceFile(path);
      if (!source) {
        violations.push({ file, message: "cannot scan source for Store imports" });
        continue;
      }
      const hit = firstStoreAccess(source);
      if (!hit) continue;
      const { line } = source.getLineAndCharacterOfPosition(hit.getStart(source));
      violations.push({
        file,
        line: line + 1,
        message: `unscoped Store from @openboard/ports is only allowed in ${app} and ${scope}`,
      });
    }
    return violations;
  } finally {
    await api.close();
  }
}
