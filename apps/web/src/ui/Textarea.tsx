import type { ComponentProps } from "react";
import "./Textarea.css";

export function Textarea({ className = "", ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={`ui-textarea ${className}`} />;
}
