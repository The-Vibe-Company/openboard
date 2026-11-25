import { parseArgs } from "node:util";
import { ATTACHMENT_ID_PATTERN, BoardError, ConnectionName, Slug } from "@openboard/contract";
import { ensureRestoreTarget, importSqlite, RestoreDestinationExists } from "./compose.ts";
import { readBoardEvents, withImportArchive } from "./import-archive.ts";

const slugPattern = new RegExp(Slug.pattern ?? "(?!)");
const connectionPattern = new RegExp(ConnectionName.pattern ?? "(?!)");

class ImportUsageError extends BoardError {
  constructor(message: string) {
    super("invalid_request", message);
  }
}
const hash = /^[a-f0-9]{64}$/;

type EntryMap = ReadonlyMap<string, Blob>;
interface Board {
  id: number;
  slug: string;
  head: number;
}
interface Connection {
  board: number;
  name: string;
}

function options(args: readonly string[]) {
  try {
    const { positionals, values } = parseArgs({
      args: [...args],
      options: { to: { type: "string" }, board: { type: "string" } },
      allowPositionals: true,
    });
    const [archive] = positionals;
    if (positionals.length === 1 && archive && values.to) return { archive, to: values.to, board: values.board };
  } catch {
    // Report a consistent usage error for any invalid argument.
  }
  throw new ImportUsageError("Usage: openboard import <archive.tar.gz> --to <directory> [--board <slug>]");
}

async function manifest(entries: EntryMap) {
  try {
    const value = await entries.get("manifest.json")?.json();
    if (value?.version !== 1) throw new Error("Unsupported format version");
    const boards: Board[] = value.boards;
    const connections: Connection[] = value.connections;
    if (
      !Array.isArray(boards) ||
      boards.some(
        (board) =>
          !board ||
          !Number.isSafeInteger(board.id) ||
          board.id < 1 ||
          typeof board.slug !== "string" ||
          !slugPattern.test(board.slug) ||
          !Number.isSafeInteger(board.head) ||
          board.head < 0,
      ) ||
      new Set(boards.map(({ id }) => id)).size !== boards.length ||
      new Set(boards.map(({ slug }) => slug)).size !== boards.length ||
      !Array.isArray(connections) ||
      connections.some(
        (connection) =>
          !connection ||
          !boards.some(({ id }) => connection.board === id) ||
          typeof connection.name !== "string" ||
          !connectionPattern.test(connection.name),
      )
    )
      throw new Error("Invalid boards or connections");
    return { boards, connections, allowMissingAttachments: value.attachments === "not yet supported" };
  } catch (cause) {
    const detail =
      cause instanceof Error && cause.message === "Unsupported format version" ? "Unsupported version in" : "Invalid";
    throw new Error(`${detail} manifest.json`, { cause });
  }
}

function attachment(entries: EntryMap, board: number) {
  return async (id: string) => {
    if (typeof id !== "string" || !ATTACHMENT_ID_PATTERN.test(id)) throw new Error("Invalid attachment ID");
    const path = `attachments/${board}/${id}.json`;
    const file = entries.get(path);
    if (!file) return null;
    try {
      const data = await file.json();
      if (
        !data ||
        typeof data.sha256 !== "string" ||
        !hash.test(data.sha256) ||
        (data.uploader !== undefined && typeof data.uploader !== "string") ||
        (data.at !== undefined && !Number.isSafeInteger(data.at))
      )
        throw new Error("Invalid attachment mapping");
      // Backup flags belong to the source instance. Fresh local backups must ship these bytes again.
      return {
        sha256: data.sha256 as string,
        uploader: data.uploader as string | undefined,
        at: data.at as number | undefined,
      };
    } catch {
      throw new BoardError("invalid_request", `Invalid attachment metadata ${path}`);
    }
  };
}

export async function importOrganization(
  args: readonly string[],
  output: { out: (line: string) => void; err: (line: string) => void },
) {
  try {
    const { archive, to, board: requested } = options(args);
    await ensureRestoreTarget(to);
    return await withImportArchive(archive, async (entries) => {
      const { boards, connections, allowMissingAttachments } = await manifest(entries);
      const name = requested ?? (boards.length === 1 ? boards[0]?.slug : "main");
      const board = boards.find(({ slug }) => slug === name);
      if (!board) throw new ImportUsageError(`Board ${JSON.stringify(name ?? "main")} is absent from manifest.json`);
      const { events, files } = await importSqlite(
        to,
        {
          events: readBoardEvents(entries, board),
          attachment: attachment(entries, board.id),
          blob: (hash) => entries.get(`blobs/sha256/${hash}`),
          allowMissingAttachments,
        },
        Date.now,
      );
      output.out(`Imported ${board.slug} as local/main (${events} events, ${files} files)`);
      const omitted = boards.filter(({ id }) => id !== board.id).map(({ slug }) => slug);
      if (omitted.length) output.out(`Boards left out: ${omitted.join(", ")}`);
      if (allowMissingAttachments) output.out("This export does not include attachment bytes.");
      for (const connection of connections) {
        const source = boards.find(({ id }) => id === connection.board);
        output.out(
          `Connection ${source?.slug}/${connection.name} was not imported. To recreate it on its board: ob connections create ${connection.name} --can '<pattern=permissions>' --secret-file '<path>'`,
        );
      }
      return 0;
    });
  } catch (error) {
    const code = error instanceof BoardError ? error.code : "invalid_request";
    const message = error instanceof Error ? error.message : "Could not import organization export";
    output.err(`error: ${code}: ${message}`);
    return error instanceof ImportUsageError || error instanceof RestoreDestinationExists ? 2 : 1;
  }
}
