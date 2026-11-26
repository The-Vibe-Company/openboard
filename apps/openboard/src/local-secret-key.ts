import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, mkdtemp, open, realpath, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { type Config, ConfigError } from "./config.ts";

async function readKey(path: string): Promise<Uint8Array> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.size !== 32)
      throw new ConfigError("Local secret-key must be a regular 32-byte file with mode 0600");
    const key = await file.readFile();
    if (key.length !== 32) throw new ConfigError("Local secret-key must contain exactly 32 bytes");
    return key;
  } finally {
    await file.close();
  }
}

async function publishKey(dir: string, path: string) {
  const temp = await mkdtemp(join(dir, ".secret-key-"));
  try {
    const candidate = join(temp, "key");
    const file = await open(candidate, "wx", 0o600);
    try {
      await file.writeFile(crypto.getRandomValues(new Uint8Array(32)));
      await file.sync();
    } finally {
      await file.close();
    }
    // Publish only a complete key. A competing startup may already have installed its own.
    try {
      await link(candidate, path);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function containsDirectory(dataDir: string, directory: string): Promise<boolean> {
  try {
    const fromData = relative(await realpath(dataDir), directory);
    return !isAbsolute(fromData) && fromData !== ".." && !fromData.startsWith(`..${sep}`);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}

async function requireSeparateKeyFile(path: string, dataDirectories: readonly string[]): Promise<void> {
  try {
    const resolved = await realpath(path);
    // Bun may normalize a symlink followed by ".." differently for realpath and file reads.
    const [source, canonical] = await Promise.all([stat(path, { bigint: true }), stat(resolved, { bigint: true })]);
    if (source.dev !== canonical.dev || source.ino !== canonical.ino)
      throw new ConfigError("OPENBOARD_SECRET_KEY_FILE: use an unambiguous path to the key");
    const directory = dirname(resolved);
    for (const dataDir of dataDirectories) {
      if (await containsDirectory(dataDir, directory))
        throw new ConfigError("OPENBOARD_SECRET_KEY_FILE must be outside the data directory and Docker data volume");
    }
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError("OPENBOARD_SECRET_KEY_FILE: cannot verify that the key is outside the data directory");
  }
}

async function loadOrPublishKey(dir: string, path: string): Promise<Uint8Array> {
  try {
    return await readKey(path);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
  await publishKey(dir, path);
  return readKey(path);
}

async function syncDirectory(path: string): Promise<void> {
  const file = await open(path, "r");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}

async function localSecretKey(home: string, { dataDir, docker }: Config): Promise<Uint8Array> {
  const root = docker ? dataDir : home;
  const dir = join(root, ".config", "openboard");
  const path = join(dir, "secret-key");
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const withinData = await containsDirectory(dataDir, await realpath(dir));
    if (docker && !withinData) throw new ConfigError("Docker secret-key directory must stay inside OPENBOARD_DATA_DIR");
    if (!docker && withinData)
      throw new ConfigError("OPENBOARD_DATA_DIR must not contain the local secret-key directory");
    if (!(await lstat(dir)).isDirectory()) throw new ConfigError("The local secret-key directory must be a directory");
    await chmod(dir, 0o700);
    const key = await loadOrPublishKey(dir, path);
    // A concurrent starter may have published the file. Commit its name and any new parent directories before serving.
    for (const directory of [dir, dirname(dir), root]) await syncDirectory(directory);
    return key;
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError("Cannot load or create the local secret-key; check permissions or set OPENBOARD_SECRET_KEY");
  }
}

export async function serveSecretKey(config: Config, home: string): Promise<Uint8Array> {
  if (config.mode === "hosted") {
    if (!config.secretKey) throw new ConfigError("OPENBOARD_SECRET_KEY is required in hosted mode");
    return config.secretKey;
  }
  if (config.secretKeyFile !== undefined)
    await requireSeparateKeyFile(config.secretKeyFile, config.docker ? [config.dataDir, "/data"] : [config.dataDir]);
  return config.secretKey ?? localSecretKey(home, config);
}
