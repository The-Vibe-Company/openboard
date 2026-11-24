import type { ComponentProps } from "react";
import "./Table.css";

export function Table({ className = "", ...props }: ComponentProps<"table">) {
  return <table {...props} className={`ui-table ${className}`} />;
}
