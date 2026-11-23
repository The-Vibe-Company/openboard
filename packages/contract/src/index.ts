export * from "./entities/messages.ts";
export {
  BoardError,
  type BoardErrorOptions,
  ERRORS,
  type ErrorBody,
  type ErrorCode,
  isErrorCode,
  type NextStep,
} from "./errors.ts";
export {
  type CliSpec,
  decodeInput,
  defineOperation,
  type InputOf,
  type McpSpec,
  type Method,
  type Operation,
  type OperationInput,
  type OutputOf,
  type RawInput,
  Ref,
  type RefKind,
  refKind,
  type Scope,
} from "./operation.ts";
export { listMessages, operations, postMessage } from "./operations/index.ts";
export { UPSTREAM_VERSION } from "./protocol.ts";
