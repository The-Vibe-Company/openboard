import { defaultRangeExtractor, useWindowVirtualizer } from "@tanstack/react-virtual";
import { type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type ThreadSummary, threadPageSize } from "../api/board.ts";
import { ThreadRow } from "./ThreadRow.tsx";
import "./ThreadList.css";

type PagedThreads = {
  threads: readonly ThreadSummary[];
  fetchOlder?: () => void;
  hasOlder: boolean;
};

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

export function ThreadList({ threads, fetchOlder, hasOlder }: PagedThreads) {
  const virtual = hasOlder || threads.length > threadPageSize;
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
    const channel = element.parentElement;
    if (channel) observer.observe(channel);
    // The reconnect banner can move the channel without resizing its content.
    if (channel?.previousElementSibling) observer.observe(channel.previousElementSibling);
    return () => observer.disconnect();
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: threads.length,
    getItemKey: (index) => threads[index]?.message.id ?? index,
    // Match the fixed 64px row in ThreadRow.css.
    estimateSize: () => 64,
    // Preserve the visible thread on a live prepend after the reader scrolls into the list.
    anchorTo: scrollMargin !== null && window.scrollY > scrollMargin ? "end" : "start",
    rangeExtractor: (range) =>
      virtual ? defaultRangeExtractor(range) : Array.from({ length: threads.length }, (_, index) => index),
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
    if (anchorMissing || threads.length === 0 || lastIndex === threads.length - 1) fetchOlder?.();
  }, [anchorMissing, fetchOlder, lastIndex, threads.length]);

  const now = Date.now();
  return (
    <ol
      ref={list}
      className={virtual ? "channel-threads channel-thread-list" : "channel-threads"}
      aria-label="Latest threads"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {items.map(({ index, key, start }) => {
        const thread = threads[index];
        if (!thread) return null;
        return (
          <ThreadRow
            key={key}
            data-index={index}
            aria-posinset={index + 1}
            aria-setsize={hasOlder ? -1 : threads.length}
            style={{ transform: `translateY(${start - (scrollMargin ?? 0)}px)` }}
            onOpen={virtual ? rememberOpenedRow : undefined}
            thread={thread}
            now={now}
          />
        );
      })}
    </ol>
  );
}
