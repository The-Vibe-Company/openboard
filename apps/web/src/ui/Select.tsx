import type { ComponentProps } from "react";
import "./Select.css";

export function Select({ className = "", ...props }: ComponentProps<"select">) {
  return <select {...props} className={`ui-select ${className}`} />;
}
