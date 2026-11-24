import { useQuery } from "@tanstack/react-query";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { BoardError } from "@the-vibe-company/openboard";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { browserClient } from "../../../api/client.ts";
import "./members.css";

export const Route = createFileRoute("/$org/settings/members")({ component: OrganizationMembers });
const settingsRoute = getRouteApi("/$org/settings");

function OrganizationMembers() {
  const { org, role } = settingsRoute.useLoaderData();
  return <Members key={org.slug} org={org.slug} mayInvite={role === "admin" || role === "owner"} />;
}

function Members({ org, mayInvite }: { org: string; mayInvite: boolean }) {
  const [inviting, setInviting] = useState(false);
  const members = useQuery({
    queryKey: ["organization-members", org],
    queryFn: ({ signal }) => browserClient(window.location.origin).listMembers({ org }, { signal }),
    retry: false,
  });

  return (
    <section className="organization-members" aria-labelledby="members-title">
      <h2 id="members-title">Members</h2>
      {members.isPending && <p role="status">Loading members…</p>}
      {members.isError && (
        <p role="alert">{members.error instanceof BoardError ? members.error.message : "Could not load members."}</p>
      )}
      {members.data && (
        <ul>
          {members.data.members.map(({ principal, role }) => (
            <li key={principal}>
              <div className="member-row">
                <span>{principal}</span>
                <span>{role}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {mayInvite && (
        <button type="button" onClick={() => setInviting(true)}>
          Invite
        </button>
      )}
      {mayInvite && inviting && <InviteDialog org={org} onClose={() => setInviting(false)} />}
    </section>
  );
}

function InviteDialog({ org, onClose }: { org: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<BoardError | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
    return () => request.current?.abort();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    const data = new FormData(event.currentTarget);
    const role = data.get("role") === "admin" ? "admin" : "member";
    const email = String(data.get("email") ?? "").trim();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      // Keep the one-time URL out of the shared mutation cache.
      const result = await browserClient(window.location.origin).createInvitation(
        { org, role, ...(email && { email }) },
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) setUrl(result.url);
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(
          failure instanceof BoardError ? failure : new BoardError("unreachable", "Could not create invitation."),
        );
      }
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  return (
    <dialog ref={dialog} aria-labelledby="invite-title" onClose={onClose}>
      <h3 id="invite-title">{url ? "Invitation link" : "Invite a member"}</h3>
      {url ? (
        <InvitationLink url={url} />
      ) : (
        <InviteForm pending={pending} error={error} onSubmit={submit} onCancel={() => dialog.current?.close()} />
      )}
    </dialog>
  );
}

function InvitationLink({ url }: { url: string }) {
  const link = useRef<HTMLInputElement>(null);
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => link.current?.focus(), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopyStatus("Link copied.");
    } catch {
      setCopyStatus("Copy failed. Select the link and copy it manually.");
    }
  }

  return (
    <>
      <p>Copy this link now. It is shown only once.</p>
      <label>
        Invitation link
        <input ref={link} readOnly value={url} />
      </label>
      <button type="button" onClick={copy}>
        Copy
      </button>
      <p role="status">{copyStatus}</p>
      <form method="dialog">
        <button type="submit">Done</button>
      </form>
    </>
  );
}

function InviteForm({
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  pending: boolean;
  error: BoardError | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  return (
    <form onSubmit={onSubmit}>
      <fieldset disabled={pending}>
        <label>
          Role
          <select name="role" defaultValue="member">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label>
          Email (optional)
          <input name="email" type="email" maxLength={254} />
        </label>
      </fieldset>
      <div className="invitation-actions">
        <button type="submit" disabled={pending}>
          Create invitation
        </button>
        <button type="button" onClick={onCancel}>
          Close
        </button>
      </div>
      {pending && (
        <p role="status">Creating invitation… If you close this dialog, the invitation may still be created.</p>
      )}
      {error && (
        <div role="alert">
          <p>{error.message}</p>
          {error.hint && <p>{error.hint}</p>}
        </div>
      )}
    </form>
  );
}
