import type { ComponentProps } from "react";
import "./Button.css";

type ButtonProps = ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "tertiary" | "danger";
  size?: "small" | "medium";
  pending?: boolean;
};

export function Button({
  variant = "primary",
  size = "medium",
  pending,
  disabled,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={`ui-button ${className}`}
      data-variant={variant}
      data-size={size}
      disabled={disabled || pending}
      aria-busy={pending || props["aria-busy"]}
    />
  );
}
