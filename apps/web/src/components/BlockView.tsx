import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useId } from "react";
import { schemaQuery } from "../api/schemas.ts";
import "./BlockView.css";

function object(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
}

function fieldValue(value: unknown, schema: unknown): ReactNode {
  const definition = object(schema);
  const data = object(value);
  if (data) return <BlockFields data={data} schema={definition} />;
  if (Array.isArray(value)) {
    const items = definition?.items;
    return (
      <ul>
        {value.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: JSON arrays have positional items and no IDs.
          <li key={index}>{fieldValue(item, Array.isArray(items) ? items[index] : items)}</li>
        ))}
      </ul>
    );
  }
  if (definition?.format === "uri" && typeof value === "string" && /^https?:\/\//i.test(value)) {
    const url = URL.parse(value);
    if (url && (url.protocol === "https:" || url.protocol === "http:"))
      return (
        <a href={url.href} target="_blank" rel="noopener noreferrer">
          {value}
        </a>
      );
  }
  return String(value);
}

export function BlockFields({
  data,
  schema,
}: {
  data: Record<string, unknown>;
  schema?: Record<string, unknown> | undefined;
}) {
  const properties = object(schema?.properties) ?? {};
  const names = [
    ...Object.keys(properties).filter((name) => Object.hasOwn(data, name)),
    ...Object.keys(data).filter((name) => !Object.hasOwn(properties, name)),
  ];
  return (
    <dl>
      {names.map((name) => {
        const property = Object.hasOwn(properties, name) ? properties[name] : undefined;
        const title = object(property)?.title;
        return (
          <div key={name}>
            <dt>{typeof title === "string" && title ? title : name}</dt>
            <dd>{fieldValue(data[name], property ?? schema?.additionalProperties)}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export function BlockView({
  id,
  data,
  source,
  board,
}: {
  id: string;
  data: Record<string, unknown>;
  source: string;
  board: { org: string; board: string };
}) {
  const title = useId();
  const { data: schema } = useQuery(schemaQuery(board, id));
  return (
    <section className="message-block" aria-labelledby={title}>
      <h3 id={title}>{id}</h3>
      <BlockFields data={data} schema={schema} />
      <details>
        <summary>Raw JSON</summary>
        <pre>
          <code>{source}</code>
        </pre>
      </details>
    </section>
  );
}
