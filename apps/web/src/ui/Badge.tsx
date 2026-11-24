import type { ComponentProps } from "react";
import "./Badge.css";

export function Badge({ className = "", ...props }: ComponentProps<"span">) {
  return <span {...props} className={`ui-badge ${className}`} />;
}
