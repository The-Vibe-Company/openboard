import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, loadConfig } from "../src/config.ts";
import { serveSecretKey } from "../src/local-secret-key.ts";

const load = (env: Record<string, string>) => loadConfig({ OPENBOARD_DATA_DIR: "./.openboard-test", ...env });

test("refuses a secret key set through both environment variables, even when one is empty", () => {
  const message = /^OPENBOARD_SECRET_KEY and OPENBOARD_SECRET_KEY_FILE cannot both be set$/;
  for (const env of [
    { OPENBOARD_SECRET_KEY: "example", OPENBOARD_SECRET_KEY_FILE: "./secret-key" },
    { OPENBOARD_SECRET_KEY: "", OPENBOARD_SECRET_KEY_FILE: "./secret-key" },
    { OPENBOARD_SECRET_KEY: "example", OPENBOARD_SECRET_KEY_FILE: "" },
  ]) {
    expect(() => load(env)).toThrow(ConfigError);
    expect(() => load(env)).toThrow(message);
  }
});

describe("the listener host", () => {
  const hosted = { OPENBOARD_DATABASE_URL: "postgres://board@db.example/openboard" };

  test("defaults to loopback in local mode and all IPv4 interfaces in hosted mode", () => {
    expect(load({}).host).toBe("127.0.0.1");
    expect(load(hosted).host).toBe("0.0.0.0");
  });

  test("uses an explicit bind address in either mode", () => {
    expect(load({ OPENBOARD_HOST: "0.0.0.0" }).host).toBe("0.0.0.0");
    expect(load({ ...hosted, OPENBOARD_HOST: "::1" }).host).toBe("::1");
  });

  test("rejects an empty or whitespace-containing host", () => {
    for (const host of ["", " ", "board example"]) {
      expect(() => load({ OPENBOARD_HOST: host })).toThrow(/^OPENBOARD_HOST: expected a hostname or IP address$/);
    }
  });
});

describe("the public URL board URLs are built on", () => {
  test("defaults to the loopback origin on the configured port", () => {
    expect(load({ PORT: "9000" }).publicUrl).toBe("http://127.0.0.1:9000");
  });

  test("is OPENBOARD_PUBLIC_URL as an origin, without its trailing slash", () => {
    expect(load({ OPENBOARD_PUBLIC_URL: "https://board.example/" }).publicUrl).toBe("https://board.example");
  });

  test("refuses a value that is not a bare http or https origin, naming the variable", () => {
    for (const value of ["board.example", "ftp://board.example", "https://board.example/api", "https://a@b.example"]) {
      expect(() => load({ OPENBOARD_PUBLIC_URL: value })).toThrow(ConfigError);
      expect(() => load({ OPENBOARD_PUBLIC_URL: value })).toThrow(/^OPENBOARD_PUBLIC_URL: /);
    }
  });

  test("reports a bad PORT once, not as a bad public URL too", () => {
    expect(() => load({ PORT: "70000" })).toThrow(/^PORT: expected 1 to 65535, got 70000$/);
  });
});

describe("the log level", () => {
  test("accepts debug, info, warn or error, and nothing else is required", () => {
    for (const level of ["debug", "info", "warn", "error"])
      expect(() => load({ OPENBOARD_LOG_LEVEL: level })).not.toThrow();
    expect(() => load({})).not.toThrow();
  });

  test("refuses an unknown level, naming the variable and the values it accepts", () => {
    expect(() => load({ OPENBOARD_LOG_LEVEL: "loud" })).toThrow(ConfigError);
    expect(() => load({ OPENBOARD_LOG_LEVEL: "loud" })).toThrow(
      /^OPENBOARD_LOG_LEVEL: expected debug, info, warn, error, got loud$/,
    );
  });
});

describe("sign-in and sign-up", () => {
  test("offer no sign-up and no GitHub sign-in by default", () => {
    const config = load({});
    expect(config.signup).toBe("closed");
    expect(config.github).toBeUndefined();
  });

  test("take OPENBOARD_SIGNUP and the GitHub client, its secret also from a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "openboard-config-"));
    try {
      writeFileSync(join(dir, "client-secret"), "example-client-secret\n");
      const env = { OPENBOARD_SIGNUP: "open", OPENBOARD_GITHUB_CLIENT_ID: "example-client" };
      expect(load({ ...env, OPENBOARD_GITHUB_CLIENT_SECRET: "example-client-secret" })).toMatchObject({
        signup: "open",
        github: { clientId: "example-client", clientSecret: "example-client-secret" },
      });
      const fromFile = load({ ...env, OPENBOARD_GITHUB_CLIENT_SECRET_FILE: join(dir, "client-secret") });
      expect(fromFile.github?.clientSecret).toBe("example-client-secret");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refuse a bad sign-up mode and half a GitHub client, naming the variables", () => {
    expect(() => load({ OPENBOARD_SIGNUP: "maybe" })).toThrow(/^OPENBOARD_SIGNUP: expected open, invite, closed/);
    expect(() => load({ OPENBOARD_GITHUB_CLIENT_ID: "example-client" })).toThrow(
      /^OPENBOARD_GITHUB_CLIENT_ID and OPENBOARD_GITHUB_CLIENT_SECRET: set both, or neither$/,
    );
    expect(() => load({ OPENBOARD_GITHUB_CLIENT_SECRET_FILE: "./missing-secret" })).toThrow(
      /OPENBOARD_GITHUB_CLIENT_SECRET_FILE: cannot read the file it names/,
    );
  });
});

describe("the database URL", () => {
  const url = "postgresql://board@db.example/openboard";

  test("defaults to local mode and selects hosted mode when configured", () => {
    expect(load({}).mode).toBe("local");
    expect(load({ OPENBOARD_DATABASE_URL: url })).toMatchObject({ mode: "hosted", databaseUrl: url });
  });

  test("reads a URL from a file and rejects dual configuration", () => {
    const dir = mkdtempSync(join(tmpdir(), "openboard-config-"));
    try {
      const file = join(dir, "database-url");
      writeFileSync(file, `${url}\n`);
      expect(load({ OPENBOARD_DATABASE_URL_FILE: file })).toMatchObject({ mode: "hosted", databaseUrl: url });
      expect(() => load({ OPENBOARD_DATABASE_URL: "", OPENBOARD_DATABASE_URL_FILE: file })).toThrow(
        /^OPENBOARD_DATABASE_URL and OPENBOARD_DATABASE_URL_FILE cannot both be set/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects invalid URLs without printing the value", () => {
    expect(() => load({ OPENBOARD_DATABASE_URL: "https://user:example@db.example" })).toThrow(
      /^OPENBOARD_DATABASE_URL: expected a postgres or postgresql URL with a host$/,
    );
  });
});

describe("hosted backup bucket", () => {
  const env = {
    OPENBOARD_BACKUP_S3_ENDPOINT: "https://storage.example/",
    OPENBOARD_BACKUP_S3_BUCKET: "backups",
    OPENBOARD_BACKUP_S3_REGION: "test-region",
    OPENBOARD_BACKUP_S3_ACCESS_KEY_ID: "sample-access",
  };
  test("requires all five variables and accepts the secret from a file", () => {
    expect(load({}).backup).toBeUndefined();
    for (const name of [...Object.keys(env), "OPENBOARD_BACKUP_S3_SECRET_ACCESS_KEY"]) {
      expect(() => load(env)).toThrow(name);
    }
    const dir = mkdtempSync(join(tmpdir(), "openboard-backup-"));
    try {
      const file = join(dir, "secret");
      writeFileSync(file, "sample-secret\n");
      expect(load({ ...env, OPENBOARD_BACKUP_S3_SECRET_ACCESS_KEY_FILE: file }).backup).toEqual({
        endpoint: "https://storage.example",
        bucket: "backups",
        region: "test-region",
        accessKeyId: "sample-access",
        secretAccessKey: "sample-secret",
      });
      expect(() =>
        load({
          ...env,
          OPENBOARD_BACKUP_S3_SECRET_ACCESS_KEY: "sample-secret",
          OPENBOARD_BACKUP_S3_SECRET_ACCESS_KEY_FILE: file,
        }),
      ).toThrow(
        "OPENBOARD_BACKUP_S3_SECRET_ACCESS_KEY and OPENBOARD_BACKUP_S3_SECRET_ACCESS_KEY_FILE cannot both be set",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("decodes a 32-byte webhook key and refuses malformed encodings", () => {
  const sample = Buffer.alloc(32, 254);
  for (const encoding of ["base64", "base64url"] as const) {
    expect(load({ OPENBOARD_SECRET_KEY: sample.toString(encoding) }).secretKey).toEqual(sample);
  }
  expect(() => load({ OPENBOARD_SECRET_KEY: "short" })).toThrow("expected 32 bytes encoded as base64 or base64url");
});

test("parses exact webhook hosts and additional HTTPS ports", () => {
  expect(
    load({
      OPENBOARD_WEBHOOK_ALLOWED_HOSTS: "Hooks.Corp., other.example",
      OPENBOARD_WEBHOOK_ALLOWED_PORTS: "8443, 9443",
    }).webhookTargets,
  ).toEqual({ hosts: ["hooks.corp", "other.example"], ports: [8443, 9443] });
});

test("names invalid webhook allow-list variables", () => {
  for (const host of ["not a host", "*.example", "https://hooks.corp", "hooks.corp:8443", "hooks.corp,"]) {
    expect(() => load({ OPENBOARD_WEBHOOK_ALLOWED_HOSTS: host })).toThrow(/^OPENBOARD_WEBHOOK_ALLOWED_HOSTS:/);
  }
  for (const port of ["0", "65536", "x", "443,"]) {
    expect(() => load({ OPENBOARD_WEBHOOK_ALLOWED_PORTS: port })).toThrow(/^OPENBOARD_WEBHOOK_ALLOWED_PORTS:/);
  }
});

test("opts in to custom webhook signing only with the rollout flag", () => {
  expect(load({}).webhookCustomSigning).toBe(false);
  expect(load({ OPENBOARD_WEBHOOK_CUSTOM_SIGNING: "off" }).webhookCustomSigning).toBe(false);
  expect(load({ OPENBOARD_WEBHOOK_CUSTOM_SIGNING: "on" }).webhookCustomSigning).toBe(true);
  expect(() => load({ OPENBOARD_WEBHOOK_CUSTOM_SIGNING: "true" })).toThrow("expected on or off");
});

function keyFixture() {
  const home = mkdtempSync(join(tmpdir(), "openboard-key-"));
  const configDir = join(home, ".config", "openboard");
  return {
    home,
    configDir,
    keyFile: join(configDir, "secret-key"),
    close: () => rmSync(home, { recursive: true, force: true }),
  };
}

test("hosted serve requires a configured secret key", async () => {
  const config = load({ OPENBOARD_DATABASE_URL: "postgres://127.0.0.1:1/board" });
  await expect(serveSecretKey(config, "/unused")).rejects.toThrow("OPENBOARD_SECRET_KEY is required in hosted mode");
});

test("plain local startup persists a private key shared by concurrent and later startups", async () => {
  const fixture = keyFixture();
  const data = join(fixture.home, "data");
  const config = load({ OPENBOARD_DATA_DIR: data });
  try {
    const [key, concurrent] = await Promise.all([
      serveSecretKey(config, fixture.home),
      serveSecretKey(config, fixture.home),
    ]);
    expect(key?.length).toBe(32);
    expect(Buffer.from(key ?? []).equals(Buffer.from(concurrent ?? []))).toBe(true);
    const first = statSync(fixture.keyFile);
    expect(first.mode & 0o777).toBe(0o600);
    expect(statSync(fixture.configDir).mode & 0o777).toBe(0o700);
    expect(existsSync(data)).toBe(false); // The SQLite driver creates and sets the mode of its own directory.
    const reopened = await serveSecretKey(config, fixture.home);
    expect(Buffer.from(key ?? []).equals(Buffer.from(reopened ?? []))).toBe(true);
    expect(statSync(fixture.keyFile).ino).toBe(first.ino);
  } finally {
    fixture.close();
  }
});

test("plain local startup rejects a data directory that resolves to the key directory", async () => {
  const fixture = keyFixture();
  try {
    const message = "OPENBOARD_DATA_DIR must not contain the local secret-key directory";
    await expect(serveSecretKey(load({ OPENBOARD_DATA_DIR: fixture.configDir }), fixture.home)).rejects.toThrow(
      message,
    );
    const alias = join(fixture.home, "data");
    symlinkSync(fixture.configDir, alias);
    await expect(serveSecretKey(load({ OPENBOARD_DATA_DIR: alias }), fixture.home)).rejects.toThrow(message);
    expect(existsSync(fixture.keyFile)).toBe(false);
  } finally {
    fixture.close();
  }
});

test("Docker startup uses only a configured key outside the data directory", async () => {
  const fixture = keyFixture();
  const secrets = mkdtempSync(join(tmpdir(), "openboard-mounted-secret-"));
  const env = { OPENBOARD_DATA_DIR: fixture.home, OPENBOARD_DOCKER: "on" };
  try {
    expect(await serveSecretKey(load(env), fixture.home)).toBeUndefined();
    const key = Buffer.alloc(32, 5);
    const mount = join(secrets, "key");
    writeFileSync(mount, key.toString("base64"), { mode: 0o600 });
    const configured = await serveSecretKey(load({ ...env, OPENBOARD_SECRET_KEY_FILE: mount }), fixture.home);
    expect(Buffer.from(configured ?? []).equals(key)).toBe(true);

    const misplaced = join(fixture.home, "key");
    writeFileSync(misplaced, key.toString("base64"), { mode: 0o600 });
    for (const docker of ["off", "on"]) {
      const config = load({ ...env, OPENBOARD_DOCKER: docker, OPENBOARD_SECRET_KEY_FILE: misplaced });
      await expect(serveSecretKey(config, fixture.home)).rejects.toThrow("OPENBOARD_SECRET_KEY_FILE must be outside");
    }
    expect(existsSync(fixture.keyFile)).toBe(false);
  } finally {
    rmSync(secrets, { recursive: true, force: true });
    fixture.close();
  }
});

test("rejects a key file path whose canonical spelling selects a different file", async () => {
  const fixture = keyFixture();
  try {
    const data = join(fixture.home, "data");
    const nested = join(data, "nested");
    const outside = join(fixture.home, "outside");
    mkdirSync(nested, { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(data, "key"), Buffer.alloc(32, 5).toString("base64"), { mode: 0o600 });
    writeFileSync(join(outside, "key"), Buffer.alloc(32, 6).toString("base64"), { mode: 0o600 });
    symlinkSync(nested, join(outside, "alias"));
    const config = load({
      OPENBOARD_DATA_DIR: data,
      OPENBOARD_DOCKER: "on",
      OPENBOARD_SECRET_KEY_FILE: `${outside}/alias/../key`,
    });
    await expect(serveSecretKey(config, fixture.home)).rejects.toThrow(/OPENBOARD_SECRET_KEY_FILE/);
  } finally {
    fixture.close();
  }
});
