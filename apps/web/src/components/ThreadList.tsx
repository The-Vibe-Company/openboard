import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { type MouseEvent, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
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

function useScrollMargin(list: RefObject<HTMLOListElement | null>) {
  const [scrollMargin, setScrollMargin] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = list.current;
    const channel = element?.parentElement;
    if (!element || !channel) return;
    const measureTop = () => setScrollMargin(element.getBoundingClientRect().top + window.scrollY);
    const observer = new ResizeObserver(measureTop);
    const observeLayout = () => {
      observer.disconnect();
      observer.observe(channel);
      // The reconnect banner can move the channel without resizing its content.
      if (channel.previousElementSibling) observer.observe(channel.previousElementSibling);
      for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        observer.observe(sibling);
      }
      measureTop();
    };
    observeLayout();
    const children = new MutationObserver(observeLayout);
    children.observe(channel, { childList: true });
    return () => {
      children.disconnect();
      observer.disconnect();
    };
  }, [list]);
  return scrollMargin;
}

function useThreadClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);
  return now;
}

function usePreserveHeaderScroll(offset: number | null, margin: number | null, firstId: string | undefined) {
  const previousFirst = useRef(firstId);
  useLayoutEffect(() => {
    const top = window.scrollY;
    const changed = previousFirst.current !== firstId;
    previousFirst.current = firstId;
    if (!changed || margin === null || top > margin || offset === null || offset <= margin) return;
    // Keep the post-submit header scroll if router restoration replays the old offset in this commit.
    queueMicrotask(() => {
      if (window.scrollY > margin) window.scrollTo({ top });
    });
  }, [firstId, margin, offset]);
}

export function ThreadList({ threads, fetchOlder, hasOlder }: PagedThreads) {
  const virtual = hasOlder || threads.length > threadPageSize;
  const list = useRef<HTMLOListElement>(null);
  const now = useThreadClock();
  const scrollMargin = useScrollMargin(list);

  const virtualizer = useWindowVirtualizer({
    count: threads.length,
    enabled: virtual,
    getItemKey: (index) => threads[index]?.message.id ?? index,
    estimateSize: () => 76,
    // Preserve the visible thread on a live prepend after the reader scrolls into the list.
    anchorTo: scrollMargin !== null && window.scrollY > scrollMargin ? "end" : "start",
    overscan: 10,
    scrollMargin: scrollMargin ?? 0,
  });
  usePreserveHeaderScroll(virtualizer.scrollOffset, scrollMargin, threads[0]?.message.id);
  const [anchor, setAnchor] = useState<string | undefined>(() => window.history.state?.openboardThreadAnchor);
  const anchorIndex = anchor === undefined ? -1 : threads.findIndex(({ message }) => message.id === anchor);
  useLayoutEffect(() => {
    if (anchorIndex >= 0 && scrollMargin !== null) virtualizer.scrollToIndex(anchorIndex, { align: "center" });
  }, [anchorIndex, scrollMargin, virtualizer]);

  const items = virtual
    ? virtualizer.getVirtualItems()
    : threads.map(({ message }, index) => ({ index, key: message.id, start: undefined }));
  const anchorMissing = anchor !== undefined && anchorIndex < 0;
  useLayoutEffect(() => {
    if (anchor === undefined || scrollMargin === null || (anchorMissing && hasOlder)) return;
    if (!anchorMissing) {
      if (!items.some(({ index }) => index === anchorIndex)) return;
      const link = list.current?.querySelector<HTMLAnchorElement>(`li[data-index="${anchorIndex}"] a`);
      if (!link) return;
      link.focus({ preventScroll: virtual });
    }
    const state = window.history.state;
    if (state?.openboardThreadAnchor === anchor) {
      const nextState = { ...state };
      delete nextState.openboardThreadAnchor;
      window.history.replaceState(nextState, "");
    }
    setAnchor(undefined);
  }, [anchor, anchorIndex, anchorMissing, hasOlder, items, scrollMargin, virtual]);
  const lastIndex = items.at(-1)?.index;
  useEffect(() => {
    if (anchorMissing || threads.length === 0 || lastIndex === threads.length - 1) fetchOlder?.();
  }, [anchorMissing, fetchOlder, lastIndex, threads.length]);

  return (
    <ol
      ref={list}
      className={virtual ? "channel-threads channel-thread-list" : "channel-threads"}
      aria-label="Latest threads"
      style={virtual ? { height: virtualizer.getTotalSize() } : undefined}
    >
      {items.map(({ index, key, start }) => {
        const thread = threads[index];
        if (!thread) return null;
        return (
          <ThreadRow
            key={key}
            ref={virtual ? virtualizer.measureElement : undefined}
            data-index={index}
            aria-posinset={index + 1}
            aria-setsize={hasOlder ? -1 : threads.length}
            style={start === undefined ? undefined : { transform: `translateY(${start - (scrollMargin ?? 0)}px)` }}
            onOpen={virtual ? rememberOpenedRow : undefined}
            thread={thread}
            now={now}
          />
        );
      })}
    </ol>
  );
}
