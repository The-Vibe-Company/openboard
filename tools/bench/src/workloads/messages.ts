import type { Instance, Server } from "../drivers";
import { type Cost, send, summarize, type WorkloadResult } from "./request";

/** How many times each workload runs: the full bench, or the reduced quick one the required check runs. */
export interface Sizes {
  readonly posts: number;
  readonly replies: number;
  readonly reads: number;
}

/** docs/codebase.md 6.6: 2,000 posts, 2,000 replies, 200 channel reads of 50. */
export const fullSizes: Sizes = { posts: 2000, replies: 2000, reads: 200 };
export const quickSizes: Sizes = { posts: 500, replies: 500, reads: 100 };

const CHANNEL = "bench";
/** Unmeasured requests first, so the measured ones run on warm code and an existing channel. */
const WARMUP = 50;
const READ_LIMIT = 50;

const messageId = (body: unknown) => (body as { message: { id: string } }).message.id;

/**
 * Runs the message workloads one request at a time, each request on the next of the server's instances in turn:
 * `posts` posts to one channel, `replies` replies spread over those posts, then `reads` reads of the channel's latest
 * 50 messages.
 */
export async function runMessageWorkloads(server: Server, sizes: Sizes): Promise<WorkloadResult[]> {
  if (server.instances.length === 0) throw new Error("no instance to run the workloads on");
  if (sizes.posts < 1 || sizes.replies < 1 || sizes.reads < 1) throw new RangeError("a workload needs runs");
  let turn = 0;
  const call = (method: string, path: string, expected: number, body?: unknown) => {
    const instance = server.instances[turn++ % server.instances.length] as Instance;
    return send(instance, server.board, { method, path, body, expected });
  };
  const post = (text: string) => call("POST", "/messages", 201, { channel: CHANNEL, text });
  const read = () => call("GET", `/messages?channel=${CHANNEL}&limit=${READ_LIMIT}`, 200);

  for (let i = 0; i < WARMUP; i++) await post(`warm-up ${i}`);
  for (let i = 0; i < WARMUP; i++) await read();

  const posts: Cost[] = [];
  const roots: string[] = [];
  for (let i = 0; i < sizes.posts; i++) {
    const { cost, body } = await post(`post ${i}`);
    posts.push(cost);
    roots.push(messageId(body));
  }
  const replies: Cost[] = [];
  for (let i = 0; i < sizes.replies; i++) {
    const re = roots[i % roots.length];
    replies.push((await call("POST", "/messages", 201, { re, text: `reply ${i}` })).cost);
  }
  const reads: Cost[] = [];
  for (let i = 0; i < sizes.reads; i++) reads.push((await read()).cost);

  return [
    summarize("post", "postMessage", posts),
    summarize("reply", "postMessage", replies),
    summarize("channelRead", "listMessages", reads),
  ];
}
