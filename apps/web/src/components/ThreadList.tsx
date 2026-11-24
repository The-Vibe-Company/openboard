import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { threadPageSize, type ThreadSummary } from "../api/board.ts";
import { EmptyChannel } from "./EmptyChannel.tsx";
import { ThreadRow } from "./ThreadRow.tsx";
import "./ThreadList.css";

type PagedThreads = {
  threads: readonly ThreadSummary[];
  fetchOlder?: () => void;
  hasOlder: boolean;
};

export function ThreadList({
  board,
  channel,
  ...page
}: PagedThreads & { board: { org: string; board: string }; channel: string }) {
  if (page.threads.length === 0) return <EmptyChannel board={board} channel={channel} />;
  if (page.hasOlder || page.threads.length > threadPageSize) return <VirtualThreads {...page} />;
  const now = Date.now();
  return (
    <ol className="board-threads" aria-label="Latest threads">
      {page.threads.map((thread) => (
        <ThreadRow key={thread.message.id} thread={thread} now={now} />
      ))}
    </ol>
  );
}

function rememberOpenedRow(event: MouseEvent<HTMLAnchorElement>, id: string) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return;
  }
  window.history.replaceState({ ...window.history.state, openboardThreadAnchor: id }, "");
}

function VirtualThreads({ threads, fetchOlder, hasOlder }: PagedThreads) {
  const list = useRef<HTMLOListElement>(null);
  const [scrollMargin, setScrollMargin] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    function measureTop() {
      if (element) setScrollMargin(element.getBoundingClientRect().top + window.scrollY);
    }
    measureTop();
    const observer = new ResizeObserver(measureTop);
    if (element.parentElement) observer.observe(element.parentElement);
    return () => observer.disconnect();
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: threads.length,
    getItemKey: (index) => threads[index]?.message.id ?? index,
    estimateSize: () => 65,
    overscan: 10,
    scrollMargin: scrollMargin ?? 0,
  });
  const [anchor, setAnchor] = useState<string | undefined>(() => window.history.state?.openboardThreadAnchor);
  const anchorIndex = anchor === undefined ? -1 : threads.findIndex(({ message }) => message.id === anchor);
  useLayoutEffect(() => {
    if (anchorIndex >= 0 && scrollMargin !== null) virtualizer.scrollToIndex(anchorIndex, { align: "center" });
  }, [anchorIndex, scrollMargin, virtualizer]);

  const items = virtualizer.getVirtualItems();
  useLayoutEffect(() => {
    if (anchorIndex < 0 || !items.some(({ index }) => index === anchorIndex)) return;
    const link = list.current?.querySelector<HTMLAnchorElement>(`li[data-index="${anchorIndex}"] a`);
    link?.focus({ preventScroll: true });
    setAnchor(undefined);
  }, [anchorIndex, items]);
  const lastIndex = items.at(-1)?.index;
  const anchorMissing = anchor !== undefined && anchorIndex < 0;
  useEffect(() => {
    if (anchorMissing || lastIndex === threads.length - 1) fetchOlder?.();
  }, [anchorMissing, fetchOlder, lastIndex, threads.length]);

  const now = Date.now();
  return (
    <ol
      ref={list}
      className="board-threads channel-thread-list"
      aria-label="Latest threads"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {items.map(({ index, key, start }) => {
        const thread = threads[index];
        if (!thread) return null;
        return (
          <ThreadRow
            key={key}
            ref={virtualizer.measureElement}
            data-index={index}
            aria-posinset={index + 1}
            aria-setsize={hasOlder ? -1 : threads.length}
            style={{ transform: `translateY(${start - (scrollMargin ?? 0)}px)` }}
            onOpen={rememberOpenedRow}
            thread={thread}
            now={now}
          />
        );
      })}
    </ol>
  );
}
