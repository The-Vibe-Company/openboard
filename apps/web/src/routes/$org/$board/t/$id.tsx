import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { BoardError } from "@the-vibe-company/openboard";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { boardErrorText, boardKeys, threadsQuery } from "../../../../api/board.ts";
import { browserClient } from "../../../../api/client.ts";
import { sessionQuery } from "../../../../api/session.ts";
import { type ThreadMessage, threadErrorText, threadQuery } from "../../../../api/thread.ts";
import { Composer, type ComposerDraft } from "../../../../components/Composer.tsx";
import { MessageView } from "../../../../components/MessageView.tsx";
import { TaskState } from "../../../../components/TaskState.tsx";
import { markdownPreview } from "../../../../markdown.ts";
import { Badge, Button, ClockIcon } from "../../../../ui/index.ts";

export const Route = createFileRoute("/$org/$board/t/$id")({
  beforeLoad: ({ params }) => {
    if (!/^\d{1,128}$/.test(params.id)) throw notFound();
  },
  notFoundComponent: () => <h1>Not found</h1>,
  component: ThreadPage,
});

async function sendThreadReply(
  params: { org: string; board: string },
  queryKey: readonly unknown[],
  queryClient: ReturnType<typeof useQueryClient>,
  draft: ComposerDraft,
  root: { id: string; channel: string },
  lastId: string,
  token: string,
) {
  const refresh = async (key: readonly unknown[]) => {
    const filter = { queryKey: key, exact: true };
    await queryClient.cancelQueries(filter);
    await queryClient.invalidateQueries(filter);
  };
  try {
    await browserClient(window.location.origin, { ...params, csrf: token }).postMessage({
      ...draft,
      re: root.id,
      after: lastId,
    });
  } catch (error) {
    if (error instanceof BoardError && error.code === "newer_message") await refresh(queryKey);
    throw error;
  }
  await Promise.all([refresh(queryKey), refresh(threadsQuery(params, root.channel).queryKey)]);
}

function useThreadHeading(root: ThreadMessage | undefined, id: string, error: Error | null) {
  const text = root?.deleted ? "" : root?.text;
  const mentions = root?.mentions;
  const preview = useMemo(() => (text === undefined ? null : markdownPreview(text, mentions)), [text, mentions]);
  const title = root ? preview || `Thread #${root.id}` : error && threadErrorText(error);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusTarget = root ? id : title;
  const replyTarget = root && root.id !== id ? id : null;
  useLayoutEffect(() => {
    if (focusTarget !== null) heading.current?.focus({ preventScroll: true });
    if (replyTarget) document.getElementById(`reply-${replyTarget}`)?.scrollIntoView({ block: "nearest" });
  }, [focusTarget, replyTarget]);
  return { title, heading };
}

function ThreadPage() {
  const params = Route.useParams();
  return <ThreadDetail key={JSON.stringify([params.org, params.board, params.id])} params={params} />;
}

function ThreadDetail({ params }: { params: { org: string; board: string; id: string } }) {
  const { org, board: slug, id } = params;
  const board = useMemo(() => ({ org, board: slug }), [org, slug]);
  const [showHistory, setShowHistory] = useState(false);
  const queryClient = useQueryClient();
  const options = threadQuery(board, id, showHistory);
  const thread = useQuery({
    ...options,
    initialData: () => (showHistory ? queryClient.getQueryData(threadQuery(board, id).queryKey) : undefined),
  });
  const { data } = thread;
  const { data: session } = useQuery(sessionQuery);
  const { csrf, person } = session ?? {};
  const root = data?.message;
  const { title, heading } = useThreadHeading(root, id, thread.isError ? thread.error : null);
  if (title === null) return <p role="status">Loading thread…</p>;

  return (
    <section className="thread-page">
      {root && (
        <Link className="thread-back" to="/$org/$board" params={params} search={{ channel: root.channel }}>
          ← {root.channel}
        </Link>
      )}
      <h1 ref={heading} tabIndex={-1}>
        {title}
      </h1>
      {data && (
        <>
          <ThreadTask board={board} message={data.message} />
          <ThreadMessages
            root={data.message}
            replies={data.replies}
            board={board}
            principal={person?.principal}
            csrf={session?.signedIn ? (csrf ?? undefined) : undefined}
            loadOlder={data.hasOlder ? () => (showHistory ? void thread.refetch() : setShowHistory(true)) : undefined}
            loading={showHistory && thread.isFetching}
          />
          {thread.isRefetchError && <p role="alert">{threadErrorText(thread.error)}</p>}
          {person && csrf && (
            <Composer
              key={person.principal}
              board={params}
              placeholder="Write a reply… Markdown supported"
              onPost={(draft) =>
                sendThreadReply(
                  params,
                  options.queryKey,
                  queryClient,
                  draft,
                  data.message,
                  data.replies.at(-1)?.id ?? data.message.id,
                  csrf,
                )
              }
            />
          )}
          <ThreadSchedules
            key={JSON.stringify([params.org, params.board, params.id])}
            params={params}
            schedules={data.schedules}
            csrf={csrf ?? undefined}
            onCanceled={async () => {
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: options.queryKey, exact: true }),
                queryClient.invalidateQueries({ queryKey: boardKeys.schedules(params) }),
              ]);
            }}
          />
        </>
      )}
    </section>
  );
}

function ThreadTask({ board, message }: { board: { org: string; board: string }; message: ThreadMessage }) {
  if (message.deleted || !message.task) return null;
  return (
    <TaskState
      key={message.id}
      board={board}
      taskId={message.id}
      channel={message.channel}
      task={message.task}
      recordedState={message.labels["board.task"]}
    />
  );
}

function ThreadMessages({
  root,
  replies,
  board,
  principal,
  csrf,
  loadOlder,
  loading,
}: {
  root: ThreadMessage;
  replies: readonly ThreadMessage[];
  board: { org: string; board: string };
  principal?: string;
  csrf?: string;
  loadOlder?: () => void;
  loading: boolean;
}) {
  return (
    <ol className="thread-messages" aria-label="Thread messages">
      <li>
        <MessageView message={root} board={board} principal={principal} csrf={csrf} />
      </li>
      {loadOlder && (
        <li>
          <Button variant="secondary" pending={loading} onClick={loadOlder}>
            Load older replies
          </Button>
        </li>
      )}
      {replies.map((message) => (
        <li key={message.id} id={`reply-${message.id}`}>
          <MessageView message={message} board={board} principal={principal} csrf={csrf} />
        </li>
      ))}
    </ol>
  );
}

function ThreadSchedules({
  params,
  schedules,
  csrf,
  onCanceled,
}: {
  params: { org: string; board: string };
  schedules: readonly { id: string; state: string; text: string; next: string | null; every: number | null }[];
  csrf?: string;
  onCanceled: () => Promise<void>;
}) {
  const [canceling, setCanceling] = useState<string | null>(null);
  const [error, setError] = useState("");
  const pending = schedules.filter((item) => item.state === "pending");
  if (pending.length === 0) return null;

  async function cancel(scheduleId: string) {
    if (!csrf || canceling) return;
    setCanceling(scheduleId);
    setError("");
    try {
      await browserClient(window.location.origin, { ...params, csrf }).cancelSchedule({ id: scheduleId });
      await onCanceled();
    } catch (cause) {
      setError(cause instanceof Error ? boardErrorText(cause) : "Could not cancel schedule.");
    } finally {
      setCanceling(null);
    }
  }

  return (
    <section className="thread-schedules" aria-label="Scheduled replies">
      <h2>
        <ClockIcon width={14} height={14} /> Scheduled replies ({pending.length})
      </h2>
      {error && <p role="alert">{error}</p>}
      <ul>
        {pending.map((schedule) => (
          <li key={schedule.id}>
            <div>
              <code>{schedule.id}</code> · {schedule.text || "(empty)"}
              {schedule.next && (
                <span>
                  {" "}
                  · next <time dateTime={schedule.next}>{new Date(schedule.next).toLocaleString()}</time>
                </span>
              )}
            </div>
            <div className="thread-schedule-actions">
              {schedule.every && <Badge>every {Math.round(schedule.every / 1000)}s</Badge>}
              {csrf && (
                <Button
                  size="small"
                  variant="secondary"
                  pending={canceling === schedule.id}
                  onClick={() => void cancel(schedule.id)}
                >
                  Cancel
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
