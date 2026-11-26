import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Button, Input } from "../ui/index.ts";
import { mcpExamples, sdkConnect, sdkCreateTask, skillInstall } from "./setup-examples.ts";
import "./SecretOnce.css";

interface Setup {
  boardUrl: string;
  name: string;
  profiles: readonly string[];
}

export function connectionProfile(name: string, profiles: readonly string[]) {
  const preferred = /^[a-z][a-z0-9-]{0,31}$/.test(name) ? name : "agent";
  const matches = profiles.some((pattern) => {
    const lower = pattern.toLowerCase();
    return lower.endsWith("*") ? preferred.startsWith(lower.slice(0, -1)) : preferred === lower;
  });
  return matches ? preferred : profiles[0]?.replace(/\*$/, "") || preferred;
}

function snippets({ boardUrl, name, profiles }: Setup) {
  const profile = connectionProfile(name, profiles);
  const mcp = new URL(boardUrl);
  mcp.pathname = mcp.pathname.replace(/^\/api\//, "/mcp/");
  const tokenHint = "Set BOARD_TOKEN in your client's environment using the agent token saved by ob connect.";
  return [
    {
      label: "CLI",
      hint: `Save the connection secret to ./${name}.secret with owner-only access. Clear any BOARD_URL, BOARD_TOKEN, and BOARD_PROFILE overrides first.`,
      code: `ob connect "${boardUrl}" --as ${profile} --secret-file "./${name}.secret" &&\n  ob doctor &&\n  ob tasks`,
    },
    ...mcpExamples(boardUrl).map((snippet) => ({ ...snippet, hint: `${snippet.hint} ${tokenHint}` })),
    {
      label: "MCP",
      hint: `Use Streamable HTTP and configure the Authorization header in your client. ${tokenHint}`,
      code: `${mcp}\nAuthorization: Bearer $BOARD_TOKEN`,
    },
    {
      label: "TypeScript SDK",
      hint: "Set OPENBOARD_SECRET to the connection secret. Set OPENBOARD_TASK_KEY to a unique key for each new task and reuse it on retry. Choose a channel this connection can post to.",
      code: `import { openboard } from "@the-vibe-company/openboard";\n\n${sdkConnect(boardUrl, profile)}\n\n${sdkCreateTask("your-channel")}`,
    },
    {
      label: "Agent Skill",
      hint: "Connect with the CLI first. Set task_id to the ID of a ready task you will work on.",
      code: `${skillInstall}\nob whoami\nob tasks claim "$task_id"`,
    },
  ];
}

export function ConnectionSetup(setup: Setup) {
  const [showSetup, setShowSetup] = useState(false);
  const setupId = useId();
  return (
    <>
      <Button
        variant="secondary"
        size="small"
        aria-label={`Setup snippets for ${setup.name}`}
        aria-expanded={showSetup}
        aria-controls={setupId}
        onClick={() => setShowSetup((open) => !open)}
      >
        Setup snippets
      </Button>
      <div id={setupId} hidden={!showSetup}>
        {showSetup && <ConnectionSnippets {...setup} />}
      </div>
    </>
  );
}

export function ConnectionSnippets(setup: Setup) {
  return (
    <SetupTabs
      label={`Setup snippets for ${setup.name}`}
      options={snippets(setup).map(({ label, hint, code }) => ({
        label,
        content: (
          <>
            <p>{hint}</p>
            <CopySnippet code={code} />
          </>
        ),
      }))}
    />
  );
}

export function SetupTabs({
  label,
  options,
}: {
  label: string;
  options: readonly { label: string; content: ReactNode }[];
}) {
  const id = useId();
  const [active, setActive] = useState(0);

  function move(event: KeyboardEvent<HTMLDivElement>) {
    const last = options.length - 1;
    const next = {
      ArrowLeft: active === 0 ? last : active - 1,
      ArrowRight: active === last ? 0 : active + 1,
      Home: 0,
      End: last,
    }[event.key];
    if (typeof next !== "number") return;
    event.preventDefault();
    event.currentTarget.querySelectorAll("button")[next]?.focus();
    setActive(next);
  }

  return (
    <div className="connection-snippets">
      <div className="connection-snippet-tabs" role="tablist" aria-label={label} onKeyDown={move}>
        {options.map(({ label }, index) => (
          <button
            key={label}
            type="button"
            role="tab"
            id={`${id}-tab-${index}`}
            aria-controls={`${id}-panel-${index}`}
            aria-selected={active === index}
            tabIndex={active === index ? 0 : -1}
            onClick={() => setActive(index)}
          >
            {label}
          </button>
        ))}
      </div>
      {options.map(({ label, content }, index) => (
        <div
          key={label}
          role="tabpanel"
          id={`${id}-panel-${index}`}
          aria-labelledby={`${id}-tab-${index}`}
          hidden={active !== index}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: The panel starts with instructions before the copy button.
          tabIndex={0}
        >
          {active === index && content}
        </div>
      ))}
    </div>
  );
}

export async function copyText(value: string, label: string, setStatus: (status: string) => void) {
  try {
    await navigator.clipboard.writeText(value);
    setStatus(`${label} copied.`);
  } catch {
    setStatus("Copy failed. Select the text and copy it manually.");
  }
}

export function CopySnippet({ code, label }: { code: string; label?: string }) {
  const [status, setStatus] = useState("");
  return (
    <>
      <pre className="setup-code">
        <code>{code}</code>
      </pre>
      <div className="settings-actions-row">
        <Button variant="secondary" size="small" onClick={() => void copyText(code, label ?? "Snippet", setStatus)}>
          Copy {label ?? "snippet"}
        </Button>
        <span aria-live="polite">{status}</span>
      </div>
    </>
  );
}

export function NewConnectionSecret({ setup, secret, onClose }: { setup: Setup; secret: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [status, setStatus] = useState("");

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog
      className="secret-once"
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-warning`}
      onClose={(event) => {
        if (!event.currentTarget.open) onClose();
      }}
    >
      <h2 id={`${id}-title`}>Connection created</h2>
      <p id={`${id}-warning`} className="secret-warning">
        Save this secret now. You can only see it once.
      </p>
      <label htmlFor={`${id}-secret`}>Secret</label>
      <div className="secret-value">
        <Input id={`${id}-secret`} readOnly value={secret} />
        <Button variant="secondary" onClick={() => void copyText(secret, "Secret", setStatus)}>
          Copy
        </Button>
      </div>
      <div role="status">{status}</div>
      <ConnectionSnippets {...setup} />
      <form method="dialog">
        <Button type="submit">Done</Button>
      </form>
    </dialog>
  );
}
