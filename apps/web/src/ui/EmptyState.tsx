import type { ComponentProps } from "react";
import "./EmptyState.css";

export function EmptyState({ className = "", ...props }: ComponentProps<"div">) {
  return <div {...props} className={`ui-empty-state ${className}`} />;
}
