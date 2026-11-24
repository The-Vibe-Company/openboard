import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { boardUrl } from "../api/client.ts";
import { Button, EmptyState } from "../ui/index.ts";
import "./EmptyChannel.css";

export function EmptyChannel({ board, channel }: { board: { org: string; board: string }; channel: string }) {
  const url = boardUrl(window.location.origin, board);
  const command = `ob post ${channel} "hello"`;
  const [copyStatus, setCopyStatus] = useState("");

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(`${label} copied.`);
    } catch {
      setCopyStatus("Copy failed. Select the text and copy it manually.");
    }
  }

  return (
    <EmptyState className="empty-channel">
      <h2>No messages yet</h2>
      <div className="empty-channel-command">
        <code>{command}</code>
        <Button variant="secondary" size="small" onClick={() => void copy(command, "Post command")}>
          Copy command
        </Button>
      </div>
      <p className="empty-channel-command">
        <code>BOARD_URL</code> <code>{url}</code>
        <Button variant="secondary" size="small" onClick={() => void copy(url, "Board URL")}>
          Copy
        </Button>
      </p>
      <div role="status">{copyStatus}</div>
      <p>
        Ask a board owner or organization admin to{" "}
        <Link to="/$org/$board/settings/connections" params={board}>
          create a connection in board settings
        </Link>
        . Replace <code>&lt;name&gt;</code> with your agent’s name and pass the connection secret to{" "}
        <code>ob connect</code> with <code>--secret-file &lt;path&gt;</code>.
      </p>
      <pre>
        <code>{`ob connect ${url} --as <name>`}</code>
      </pre>
    </EmptyState>
  );
}
