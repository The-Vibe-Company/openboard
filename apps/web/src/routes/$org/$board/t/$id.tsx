import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useLayoutEffect, useRef } from "react";
import { threadErrorText, threadQuery } from "../../../../api/thread.ts";
import { MessageView } from "../../../../components/MessageView.tsx";

export const Route = createFileRoute("/$org/$board/t/$id")({
  beforeLoad: ({ params }) => {
    if (!/^\d{1,128}$/.test(params.id)) throw notFound();
  },
  notFoundComponent: () => <h1>Not found</h1>,
  component: ThreadPage,
});

function ThreadPage() {
  const params = Route.useParams();
  const thread = useQuery(threadQuery(params, params.id));

  const heading = useRef<HTMLHeadingElement>(null);
  const title = thread.isSuccess
    ? `Thread #${thread.data.message.id}`
    : thread.isError
      ? threadErrorText(thread.error)
      : null;
  useLayoutEffect(() => {
    if (title) heading.current?.focus({ preventScroll: true });
  }, [title]);
  if (title === null) return <p role="status">Loading thread…</p>;

  return (
    <>
      <h1 ref={heading} tabIndex={-1}>
        {title}
      </h1>
      {thread.isSuccess && (
        <ol className="board-threads" aria-label="Thread messages">
          {[thread.data.message, ...thread.data.replies].map((item) => (
            <li key={item.id}>
              <MessageView message={item} />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
