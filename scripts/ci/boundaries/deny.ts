import { isUtf8 } from "node:buffer";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config, Violation } from "./types.ts";
import { childDirs, workspaceFiles } from "./workspaces.ts";

/** Checks raw text so integration names in comments are included (docs/codebase.md 3.2). */
export async function checkDenyTerms(root: string, config: Config): Promise<Violation[]> {
  if (config.denyTerms.length === 0) return [];
  const terms = config.denyTerms.map((term) => RegExp.escape(term)).join("|");
  const pattern = new RegExp(`\\b(?:${terms})\\b`, "gi");
  const violations: Violation[] = [];
  for (const parent of ["packages", "apps"]) {
    for (const dir of (await childDirs(root, parent)).sort()) {
      for (const file of await workspaceFiles(root, dir)) {
        const contents = await readFile(join(root, file));
        if (contents.includes(0) || !isUtf8(contents)) continue;
        contents
          .toString("utf8")
          .split(/\r\n|[\n\r\u2028\u2029]/)
          .forEach((text, index) => {
            for (const [term] of text.matchAll(pattern)) {
              violations.push({ file, line: index + 1, message: `denied integration name "${term}"` });
            }
          });
      }
    }
  }
  return violations;
}
