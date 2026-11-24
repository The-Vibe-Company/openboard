import type { ErrorCode, operations } from "@openboard/contract";

type Contracted = (typeof operations)[number];
type OperationName = Contracted["name"];
export type Schema = {
  readonly type?: unknown;
  readonly description?: string;
  readonly "x-ref"?: string;
  readonly minimum?: number;
  readonly maximum?: number;
};

/** What a hand-written command is for, the operations it calls, and the meanings no operation field gives. */
export interface Handwritten {
  readonly summary: string;
  readonly operations: readonly OperationName[];
  readonly example: string;
  /** Meanings of flags no field of `operations` describes, keyed by flag without `--`. */
  readonly options?: Readonly<Record<string, string>>;
  /** Codes the command prints itself, beyond its operations' errors. */
  readonly errors?: readonly (ErrorCode | "timeout")[];
  /** The operations whose MCP tools do what the command does; absent, every one of `operations`. */
  readonly tools?: readonly OperationName[];
}
