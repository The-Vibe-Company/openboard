import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { Client } from "@the-vibe-company/openboard";
import { type FormEvent, useId, useState } from "react";
import { boardKeys, channelsQuery } from "../../../api/board.ts";
import { browserClient } from "../../../api/client.ts";
import { sessionQuery } from "../../../api/session.ts";
import { Badge, Button, EmptyState, Input, PlusIcon, Table, Textarea } from "../../../ui/index.ts";
import "./tasks.css";

export const Route = createFileRoute("/$org/$board/schedules")({
  component: BoardSchedulesPage,
});

type Board = { org: string; board: string };
type ScheduleItem = Awaited<ReturnType<Client["listSchedules"]>>["schedules"][number];

function formatInterval(ms: number | null) {
  if (!ms) return "Once";
  if (ms % 86_400_000 === 0) return `Every ${ms / 86_400_000}d`;
  if (ms % 3_600_000 === 0) return `Every ${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `Every ${ms / 60_000}m`;
  return `Every ${Math.round(ms / 1000)}s`;
}

function SchedulesHeader({
  showAll,
  signedIn,
  onShowAll,
  onToggleNew,
}: {
  showAll: boolean;
  signedIn: boolean;
  onShowAll: (all: boolean) => void;
  onToggleNew: () => void;
}) {
  return (
    <div className="board-view-head">
      <div>
        <h1 id="board-schedules-heading">Schedules</h1>
        <p className="board-view-sub">
          One-off and repeating scheduled posts (<code>ob schedule</code> / <code>ob schedules</code>).
        </p>
      </div>
      <div className="board-view-controls">
        <fieldset className="segmented-toggle" aria-label="Schedule filter">
          <button type="button" aria-pressed={!showAll} onClick={() => onShowAll(false)}>
            Pending
          </button>
          <button type="button" aria-pressed={showAll} onClick={() => onShowAll(true)}>
            All
          </button>
        </fieldset>
        {signedIn && (
          <Button size="small" onClick={onToggleNew}>
            <PlusIcon width={14} height={14} /> New schedule
          </Button>
        )}
      </div>
    </div>
  );
}

function BoardSchedulesPage() {
  const board = Route.useParams();
  const queryClient = useQueryClient();
  const { data: session } = useQuery(sessionQuery);
  const { data: channels = [] } = useQuery(channelsQuery(board));
  const [showAll, setShowAll] = useState(false);
  const [creating, setCreating] = useState(false);
  const [canceling, setCanceling] = useState<string | null>(null);
  const [error, setError] = useState("");

  const query = useQuery({
    queryKey: [...boardKeys.schedules(board), showAll ? "all" : "pending"],
    queryFn: ({ signal }) =>
      browserClient(window.location.origin, board).listSchedules(showAll ? { all: true } : {}, { signal }),
  });
  const schedules = query.data?.schedules ?? [];

  async function cancel(id: string) {
    if (canceling) return;
    setCanceling(id);
    setError("");
    try {
      await browserClient(window.location.origin, board).cancelSchedule({ id });
      await queryClient.invalidateQueries({ queryKey: boardKeys.schedules(board) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not cancel schedule.");
    } finally {
      setCanceling(null);
    }
  }

  return (
    <section className="board-view" aria-labelledby="board-schedules-heading">
      <SchedulesHeader
        showAll={showAll}
        signedIn={Boolean(session?.signedIn)}
        onShowAll={setShowAll}
        onToggleNew={() => setCreating((c) => !c)}
      />
      {creating && (
        <NewScheduleForm
          board={board}
          defaultChannel={channels[0]?.path || "general"}
          onCancel={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await queryClient.invalidateQueries({ queryKey: boardKeys.schedules(board) });
          }}
        />
      )}
      {error && <p role="alert">{error}</p>}
      {query.isPending && <p role="status">Loading schedules…</p>}
      {query.isError && <p role="alert">Could not load schedules.</p>}
      {!query.isPending && schedules.length === 0 && (
        <EmptyState>
          {showAll ? "No schedules recorded on this board yet." : "No pending schedules right now."}
        </EmptyState>
      )}
      {schedules.length > 0 && (
        <SchedulesTable
          board={board}
          schedules={schedules}
          signedIn={Boolean(session?.signedIn)}
          canceling={canceling}
          onCancel={(id) => void cancel(id)}
        />
      )}
    </section>
  );
}

type ScheduleDraft = {
  channel: string;
  replyTo: string;
  text: string;
  inDuration: string;
  every: string;
  times: string;
};

async function saveSchedule(board: Board, defaultChannel: string, draft: ScheduleDraft) {
  const targetReply = draft.replyTo.replace(/^#/, "").trim();
  const parsedTimes = draft.times.trim() ? Number.parseInt(draft.times.trim(), 10) : undefined;
  await browserClient(window.location.origin, board).createSchedule({
    ...(targetReply ? { re: targetReply } : { channel: draft.channel.trim() || defaultChannel }),
    text: draft.text,
    ...(draft.inDuration.trim() ? { in: draft.inDuration.trim() } : {}),
    ...(draft.every.trim() ? { every: draft.every.trim() } : {}),
    ...(parsedTimes && Number.isInteger(parsedTimes) ? { times: parsedTimes } : {}),
  });
}

function LabeledInput({
  id,
  label,
  placeholder,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <Input
        id={id}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </div>
  );
}

function ScheduleFields({
  id,
  draft,
  defaultChannel,
  busy,
  onChange,
}: {
  id: string;
  draft: ScheduleDraft;
  defaultChannel: string;
  busy: boolean;
  onChange: (patch: Partial<ScheduleDraft>) => void;
}) {
  return (
    <>
      <div className="tasks-new-grid">
        <LabeledInput
          id={`${id}-ch`}
          label="Channel"
          placeholder={defaultChannel}
          value={draft.channel}
          disabled={busy || Boolean(draft.replyTo.trim())}
          onChange={(channel) => onChange({ channel })}
        />
        <LabeledInput
          id={`${id}-re`}
          label="Or reply to thread ID"
          placeholder="Optional, e.g. 42"
          value={draft.replyTo}
          disabled={busy}
          onChange={(replyTo) => onChange({ replyTo })}
        />
        <LabeledInput
          id={`${id}-in`}
          label="First fire in (e.g. 5m, 2h)"
          placeholder="5m"
          value={draft.inDuration}
          disabled={busy}
          onChange={(inDuration) => onChange({ inDuration })}
        />
        <LabeledInput
          id={`${id}-ev`}
          label="Repeat every (optional)"
          placeholder="e.g. 1h, 1d"
          value={draft.every}
          disabled={busy}
          onChange={(every) => onChange({ every })}
        />
        <LabeledInput
          id={`${id}-tm`}
          label="Max runs (optional)"
          placeholder="e.g. 5"
          value={draft.times}
          disabled={busy}
          onChange={(times) => onChange({ times })}
        />
      </div>
      <div>
        <label htmlFor={`${id}-tx`}>Message text</label>
        <Textarea
          id={`${id}-tx`}
          rows={3}
          placeholder="Reminder or automated check-in message…"
          value={draft.text}
          disabled={busy}
          onChange={(e) => onChange({ text: e.currentTarget.value })}
        />
      </div>
    </>
  );
}

function NewScheduleForm({
  board,
  defaultChannel,
  onCancel,
  onCreated,
}: {
  board: Board;
  defaultChannel: string;
  onCancel: () => void;
  onCreated: () => Promise<void>;
}) {
  const id = useId();
  const [draft, setDraft] = useState<ScheduleDraft>({
    channel: "",
    replyTo: "",
    text: "",
    inDuration: "5m",
    every: "",
    times: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.text.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await saveSchedule(board, defaultChannel, draft);
      await onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create schedule.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="tasks-new-form" onSubmit={submit}>
      <ScheduleFields
        id={id}
        draft={draft}
        defaultChannel={defaultChannel}
        busy={busy}
        onChange={(patch) => setDraft((cur) => ({ ...cur, ...patch }))}
      />
      {error && <p role="alert">{error}</p>}
      <div className="tasks-new-actions">
        <Button type="submit" size="small" pending={busy} disabled={!draft.text.trim()}>
          Schedule post
        </Button>
        <Button type="button" size="small" variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function SchedulesTable({
  board,
  schedules,
  signedIn,
  canceling,
  onCancel,
}: {
  board: Board;
  schedules: readonly ScheduleItem[];
  signedIn: boolean;
  canceling: string | null;
  onCancel: (id: string) => void;
}) {
  return (
    <div className="settings-table">
      <Table aria-label="Board schedules">
        <thead>
          <tr>
            <th scope="col">ID</th>
            <th scope="col">Target</th>
            <th scope="col">Message</th>
            <th scope="col">Cadence</th>
            <th scope="col">Next run</th>
            <th scope="col">State</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {schedules.map((item) => (
            <tr key={item.id}>
              <td>
                <code>{item.id}</code>
              </td>
              <td>
                {item.re ? (
                  <Link to="/$org/$board/t/$id" params={{ ...board, id: item.re }} search={{ channel: item.channel }}>
                    #{item.channel} · re #{item.re}
                  </Link>
                ) : (
                  <code>#{item.channel}</code>
                )}
              </td>
              <td>{item.text || <em>(hidden)</em>}</td>
              <td>
                {formatInterval(item.every)}
                {item.times ? ` (${item.sent}/${item.times})` : item.sent > 0 ? ` (${item.sent} sent)` : ""}
              </td>
              <td>{item.next ? <time dateTime={item.next}>{new Date(item.next).toLocaleString()}</time> : "—"}</td>
              <td>
                <Badge>{item.state}</Badge>
              </td>
              <td>
                {item.state === "pending" && signedIn && (
                  <Button
                    size="small"
                    variant="secondary"
                    pending={canceling === item.id}
                    onClick={() => onCancel(item.id)}
                  >
                    Cancel
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
