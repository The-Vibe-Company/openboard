import type { ComponentProps } from "react";
import "./Input.css";

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return <input {...props} className={`ui-input ${className}`} />;
}
