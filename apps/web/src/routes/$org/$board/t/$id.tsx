import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { BoardError } from "@the-vibe-company/openboard";
import { useLayoutEffect, useRef } from "react";
import { threadsQuery } from "../../../../api/board.ts";
import { browserClient } from "../../../../api/client.ts";
import { sessionQuery } from "../../../../api/session.ts";
import { threadErrorText, threadQuery } from "../../../../api/thread.ts";
import { Composer } from "../../../../components/Composer.tsx";
import { MessageView } from "../../../../components/MessageView.tsx";
import { TaskState } from "../../../../components/TaskState.tsx";

import "./thread.css";

export const Route = createFileRoute("/$org/$board/t/$id")({
  beforeLoad: ({ params }) => {
    if (!/^\d{1,128}$/.test(params.id)) throw notFound();
  },
  notFoundComponent: () => <h1>Not found</h1>,
  component: ThreadPage,
});

function ThreadPage() {
  const params = Route.useParams();
  const options = threadQuery(params, params.id);
  const thread = useQuery(options);
  const queryClient = useQueryClient();
  const { data } = thread;
  const { data: session } = useQuery(sessionQuery);
  const { csrf, person } = session ?? {};

  async function refresh(queryKey: readonly unknown[]) {
    const filter = { queryKey, exact: true };
    await queryClient.cancelQueries(filter);
    await queryClient.invalidateQueries(filter);
  }

  async function postReply(draft: { text: string; id: string }, snapshot: NonNullable<typeof data>, csrf: string) {
    const root = snapshot.message;
    try {
      await browserClient(window.location.origin, { ...params, csrf }).postMessage({
        ...draft,
        re: root.id,
        after: snapshot.replies.at(-1)?.id ?? root.id,
      });
    } catch (error) {
      if (error instanceof BoardError && error.code === "newer_message") {
        await refresh(options.queryKey);
      }
      throw error;
    }
    await Promise.all([refresh(options.queryKey), refresh(threadsQuery(params, root.channel).queryKey)]);
  }

  const heading = useRef<HTMLHeadingElement>(null);
  const title = data ? `Thread #${data.message.id}` : thread.isError ? threadErrorText(thread.error) : null;
  useLayoutEffect(() => {
    if (title) heading.current?.focus({ preventScroll: true });
  }, [title]);
  if (title === null) return <p role="status">Loading thread…</p>;

  return (
    <section className="thread-page">
      <h1 ref={heading} tabIndex={-1}>
        {title}
      </h1>
      {data && (
        <>
          {!data.message.deleted && data.message.task && (
            <TaskState board={params} task={data.message.task} recordedState={data.message.labels["board.task"]} />
          )}
          <ol className="thread-messages" aria-label="Thread messages">
            {[data.message, ...data.replies].map((item) => (
              <li key={item.id}>
                <MessageView message={item} />
              </li>
            ))}
          </ol>
          {thread.isRefetchError && <p role="alert">{threadErrorText(thread.error)}</p>}
          {person && csrf && (
            <Composer
              key={JSON.stringify([...options.queryKey, person.principal])}
              onPost={(draft) => postReply(draft, data, csrf)}
            />
          )}
        </>
      )}
    </section>
  );
}
