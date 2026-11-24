import { join } from "node:path";

/** Bundled entries use a file loader and encode the Vite path before Bun adds its own content hash. */
export function webAssets(directory?: string) {
  const embedded = new Map<string, Blob>();
  for (const file of Bun.embeddedFiles) {
    if (!("name" in file) || typeof file.name !== "string") continue;
    const match = /^openboard-web-([\w-]+)-[\da-z]+\.obasset$/.exec(file.name);
    if (match?.[1]) embedded.set(Buffer.from(match[1], "base64url").toString(), file);
  }
  return async (path: string): Promise<Blob | undefined> => {
    if (directory === undefined) return embedded.get(path);
    const file = Bun.file(join(directory, path));
    return (await file.exists()) ? file : undefined;
  };
}
