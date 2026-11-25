import { useQuery } from "@tanstack/react-query";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { BoardError } from "@the-vibe-company/openboard";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { browserClient } from "../../../api/client.ts";
import { Avatar, Button, Card, Field, Input, Select, Table } from "../../../ui/index.ts";
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
      <Card>
        <h2 id="members-title">Members</h2>
        {members.isPending && <p role="status">Loading members…</p>}
        {members.isError && (
          <p role="alert">{members.error instanceof BoardError ? members.error.message : "Could not load members."}</p>
        )}
        {members.data && (
          <Table aria-labelledby="members-title">
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Role</th>
              </tr>
            </thead>
            <tbody>
              {members.data.members.map(({ principal, role, profile }) => (
                <tr key={principal}>
                  <td>
                    <div className="member-profile">
                      <Avatar name={profile?.handle ?? "Unknown member"} src={profile?.avatar ?? undefined} />
                      <div>
                        <strong>{profile?.handle ?? "Unknown member"}</strong>
                        {profile?.name && profile.name !== profile.handle && <div>{profile.name}</div>}
                        <code>{principal}</code>
                      </div>
                    </div>
                  </td>
                  <td>{role}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {mayInvite && (
          <footer className="settings-card-footer">
            <Button onClick={() => setInviting(true)}>Invite</Button>
          </footer>
        )}
      </Card>
      {mayInvite && inviting && <InviteDialog org={org} onClose={() => setInviting(false)} />}
    </section>
  );
}

function InviteDialog({ org, onClose }: { org: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const [invitation, setInvitation] = useState<{ url: string; sentTo?: string }>();
  const [error, setError] = useState<BoardError | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    return () => {
      if (el?.open) el.close();
      request.current?.abort();
    };
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
      if (!controller.signal.aborted) {
        setInvitation({ url: result.url, ...(result.emailSent && { sentTo: result.invitation.email ?? email }) });
      }
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
    <dialog
      ref={dialog}
      aria-labelledby="invite-title"
      onClose={(event) => {
        if (!event.currentTarget.open) onClose();
      }}
    >
      <Card>
        <h3 id="invite-title">{invitation ? "Invitation link" : "Invite a member"}</h3>
        {invitation ? (
          <InvitationLink {...invitation} />
        ) : (
          <InviteForm pending={pending} error={error} onSubmit={submit} onCancel={() => dialog.current?.close()} />
        )}
      </Card>
    </dialog>
  );
}

function InvitationLink({ url, sentTo }: { url: string; sentTo?: string }) {
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
      <p id="invitation-link-help">
        {sentTo
          ? `Invitation email sent to ${sentTo}. You can also copy the one-time link below.`
          : "Copy this link now. It is shown only once."}
      </p>
      <Field label="Invitation link">
        {(props) => <Input {...props} aria-describedby="invitation-link-help" ref={link} readOnly value={url} />}
      </Field>
      <p role="status">{copyStatus}</p>
      <form method="dialog">
        <footer className="settings-card-footer">
          <Button variant="secondary" onClick={copy}>
            Copy
          </Button>
          <Button type="submit">Done</Button>
        </footer>
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
        <Field label="Role">
          {(props) => (
            <Select {...props} name="role" defaultValue="member">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </Select>
          )}
        </Field>
        <Field label="Email (optional)">
          {(props) => <Input {...props} name="email" type="email" maxLength={254} />}
        </Field>
      </fieldset>
      {pending && (
        <p role="status">Creating invitation… If you close this dialog, the invitation may still be created.</p>
      )}
      {error && (
        <div role="alert">
          <p>{error.message}</p>
          {error.hint && <p>{error.hint}</p>}
        </div>
      )}
      <footer className="settings-card-footer">
        <Button variant="secondary" onClick={onCancel}>
          Close
        </Button>
        <Button type="submit" pending={pending}>
          Create invitation
        </Button>
      </footer>
    </form>
  );
}
