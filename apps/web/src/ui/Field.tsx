import { type ReactNode, useId } from "react";
import "./Field.css";

type FieldProps = {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode;
};

export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="ui-field">
      <label htmlFor={id}>{label}</label>
      {children({
        id,
        "aria-describedby": [hintId, errorId].filter(Boolean).join(" ") || undefined,
        "aria-invalid": errorId ? true : undefined,
      })}
      {hintId && <span id={hintId}>{hint}</span>}
      {errorId && <strong id={errorId}>{error}</strong>}
    </div>
  );
}
