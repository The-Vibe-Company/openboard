import { useRouter } from "@tanstack/react-router";
import { type MouseEvent, type ReactNode, useEffect, useId, useRef } from "react";
import { Button } from "../ui/index.ts";
import "./Switcher.css";

export function closeSwitcher(event: MouseEvent<HTMLAnchorElement>) {
  event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
}

export function Switcher({
  label,
  trigger,
  children,
  alignEnd,
}: {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  alignEnd?: boolean;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(
    () =>
      router.subscribe("onResolved", ({ pathChanged }) => {
        if (pathChanged) panel.current?.hidePopover();
      }),
    [router],
  );
  return (
    <div className="shell-switcher" data-align-end={alignEnd}>
      <Button aria-label={label} popoverTarget={id} size="small" variant="tertiary">
        {trigger}
      </Button>
      <div id={id} ref={panel} className="switcher-panel" popover="auto">
        {children}
      </div>
    </div>
  );
}
