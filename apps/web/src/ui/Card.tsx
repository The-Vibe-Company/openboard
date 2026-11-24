import type { ComponentProps } from "react";
import "./Card.css";

export function Card({ className = "", ...props }: ComponentProps<"div">) {
  return <div {...props} className={`ui-card ${className}`} />;
}
