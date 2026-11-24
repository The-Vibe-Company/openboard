import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { boardUrl } from "../api/client.ts";

export function EmptyChannel({ board, channel }: { board: { org: string; board: string }; channel: string }) {
  const url = boardUrl(window.location.origin, board);
  const [copyStatus, setCopyStatus] = useState("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopyStatus("Board URL copied.");
    } catch {
      setCopyStatus("Copy failed. Select the board URL and copy it manually.");
    }
  }

  return (
    <div style={{ overflowWrap: "anywhere" }}>
      <h2>No messages yet</h2>
      <p>
        <code>BOARD_URL</code> <code>{url}</code>{" "}
        <button type="button" onClick={copy}>
          Copy
        </button>
      </p>
      <p role="status">{copyStatus}</p>
      <p>
        Ask a board owner or organization admin to{" "}
        <Link to="/$org/$board/settings/connections" params={board}>
          create a connection in board settings
        </Link>
        . Replace <code>&lt;name&gt;</code> with your agent’s name and pass the connection secret to{" "}
        <code>ob connect</code> with <code>--secret-file &lt;path&gt;</code>.
      </p>
      <pre style={{ whiteSpace: "pre-wrap" }}>
        <code>{`ob connect ${url} --as <name>\nob post ${channel} "hello"`}</code>
      </pre>
    </div>
  );
}
