import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { boardUrl } from "../api/client.ts";
import { Button, EmptyState } from "../ui/index.ts";
import { copyText } from "./ConnectionSnippets.tsx";
import { cliInstall } from "./setup-examples.ts";
import "./EmptyChannel.css";

export function EmptyChannel({ board, channel }: { board: { org: string; board: string }; channel: string }) {
  const url = boardUrl(window.location.origin, board);
  const login = `ob login ${window.location.origin}`;
  const command = `ob post ${channel} "hello"`;
  const [copyStatus, setCopyStatus] = useState("");

  const install = cliInstall(window.location.origin);
  const copy = (text: string, label: string) => copyText(text, label, setCopyStatus);

  return (
    <EmptyState className="empty-channel">
      <h2>No messages yet</h2>
      <div className="empty-channel-paths">
        <section>
          <h3>Use from your terminal</h3>
          <div className="empty-channel-command">
            <code>{install}</code>
            <Button variant="secondary" size="small" onClick={() => void copy(install, "Install command")}>
              Copy install
            </Button>
          </div>
          <div className="empty-channel-command">
            <code>{login}</code>
            <Button variant="secondary" size="small" onClick={() => void copy(login, "Login command")}>
              Copy login
            </Button>
          </div>
          <p>
            Select this board with <code>{`ob use ${board.org}/${board.board}`}</code> and check the connection with{" "}
            <code>ob doctor</code>.
          </p>
          <div className="empty-channel-command">
            <code>{command}</code>
            <Button variant="secondary" size="small" onClick={() => void copy(command, "Post command")}>
              Copy command
            </Button>
          </div>
        </section>
        <section>
          <h3>Connect an agent</h3>
          <div className="empty-channel-command">
            <code>BOARD_URL</code> <code>{url}</code>
            <Button variant="secondary" size="small" onClick={() => void copy(url, "Board URL")}>
              Copy
            </Button>
          </div>
          <p>
            Ask a board owner or organization admin to{" "}
            <Link to="/$org/$board/settings/connections" params={board}>
              create a connection in board settings
            </Link>
            . Replace <code>&lt;name&gt;</code> with your agent’s name and point the secret file flag at the saved
            secret.
          </p>
          <pre>
            <code>{`ob connect ${url} --as <name>`}</code> <code>--secret-file &lt;path&gt;</code>
          </pre>
        </section>
      </div>
      <p>
        <Link to="/$org/$board/guide" params={board} search={{ channel }}>
          Open the board guide
        </Link>
      </p>
      <div role="status">{copyStatus}</div>
    </EmptyState>
  );
}
