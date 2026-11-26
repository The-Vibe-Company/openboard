import type { Role } from "@openboard/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { BoardError, type Client } from "@the-vibe-company/openboard";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { browserClient } from "../../../api/client.ts";
import { sessionQuery } from "../../../api/session.ts";
import { Avatar, Button, Card, Field, Input, Select, Table } from "../../../ui/index.ts";

export const Route = createFileRoute("/$org/settings/members")({ component: OrganizationMembers });
const settingsRoute = getRouteApi("/$org/settings");
const membersKey = (org: string) => ["organization-members", org];
const invitationsKey = (org: string) => ["organization-invitations", org];

function actionError(error: unknown, fallback: string) {
  if (!(error instanceof BoardError)) return fallback;
  if (error.code === "last_owner")
    return "This organization needs at least one owner. Promote another member to owner first.";
  return error.message;
}

function OrganizationMembers() {
  const { org, role } = settingsRoute.useLoaderData();
  return <Members key={org.slug} org={org.slug} role={role} />;
}

function Members({ org, role }: { org: string; role: Role }) {
  const [inviting, setInviting] = useState(false);
  const session = useQuery(sessionQuery);
  const client = browserClient(window.location.origin, { csrf: session.data?.csrf ?? undefined });
  const members = useQuery({
    queryKey: membersKey(org),
    queryFn: ({ signal }) => client.listMembers({ org }, { signal }),
    retry: false,
  });
  const self = session.data?.person?.principal;
  const actor = members.data?.members.find(({ principal }) => principal === self)?.role ?? role;
  const mayManage = actor !== "member";

  return (
    <section className="organization-members" aria-labelledby="members-title">
      <Card>
        <h2 id="members-title">Members</h2>
        {members.isPending && <p role="status">Loading members…</p>}
        {members.isError && <p role="alert">{actionError(members.error, "Could not load members.")}</p>}
        {session.isError && <p role="alert">Could not load your session. Refresh to manage membership.</p>}
        {members.data && (
          <Table aria-labelledby="members-title" className="members-table">
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Role</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.data.members.map((member) => (
                <MemberRow
                  key={member.principal}
                  member={member}
                  self={member.principal === self}
                  actor={actor}
                  ready={Boolean(self)}
                  org={org}
                  client={client}
                />
              ))}
            </tbody>
          </Table>
        )}
        {mayManage && (
          <footer className="settings-card-footer">
            <Button disabled={!self} onClick={() => setInviting(true)}>
              Invite
            </Button>
          </footer>
        )}
      </Card>
      {mayManage && <PendingInvitations org={org} client={client} ready={Boolean(self)} />}
      {mayManage && inviting && <InviteDialog org={org} client={client} onClose={() => setInviting(false)} />}
    </section>
  );
}

type Member = Awaited<ReturnType<Client["listMembers"]>>["members"][number];

function MemberRow({
  member,
  self,
  actor,
  ready,
  org,
  client,
}: {
  member: Member;
  self: boolean;
  actor: Role;
  ready: boolean;
  org: string;
  client: Client;
}) {
  const cache = useQueryClient();
  const router = useRouter();
  const { principal: user, role } = member;
  const name = member.profile?.handle ?? user;
  const canEdit = ready && (actor === "owner" || (actor === "admin" && role !== "owner"));
  const update = useMutation({
    mutationFn: async (action: Role | "remove") => {
      if (action === "remove") await client.removeMember({ org, user });
      else await client.changeMemberRole({ org, user, role: action });
    },
    onSuccess: async (_, action) => {
      if (self && action === "remove") return window.location.replace("/");
      await cache.invalidateQueries({ queryKey: membersKey(org) });
      if (self) await router.invalidate();
    },
  });

  return (
    <tr>
      <td>
        <MemberProfile member={member} self={self} />
      </td>
      <td>
        {canEdit ? (
          <Select
            aria-label={`Role for ${name}`}
            value={role}
            disabled={update.isPending}
            onChange={(event) => update.mutate(event.currentTarget.value as Role)}
          >
            <option value="member">member</option>
            <option value="admin">admin</option>
            {actor === "owner" && <option value="owner">owner</option>}
          </Select>
        ) : (
          role
        )}
      </td>
      <td>
        {(self || canEdit) && (
          <Button
            size="small"
            variant="secondary"
            aria-label={self ? "Leave organization" : `Remove ${name}`}
            disabled={update.isPending}
            onClick={() => {
              const question = self ? "Leave this organization?" : `Remove ${name} from this organization?`;
              if (window.confirm(question)) update.mutate("remove");
            }}
          >
            {self ? "Leave" : "Remove"}
          </Button>
        )}
        {update.isError && (
          <p role="alert">
            {actionError(
              update.error,
              update.variables === "remove" ? "Could not remove member." : "Could not change role.",
            )}
          </p>
        )}
      </td>
    </tr>
  );
}

function MemberProfile({ member: { principal, profile }, self }: { member: Member; self: boolean }) {
  return (
    <div className="member-profile">
      <Avatar name={profile?.handle ?? "Unknown member"} src={profile?.avatar ?? undefined} />
      <div>
        <strong>{profile?.handle ?? "Unknown member"}</strong>
        {self && " (you)"}
        {profile?.name && profile.name !== profile.handle && <div>{profile.name}</div>}
        <code>{principal}</code>
      </div>
    </div>
  );
}

function PendingInvitations({ org, client, ready }: { org: string; client: Client; ready: boolean }) {
  const cache = useQueryClient();
  const queryKey = invitationsKey(org);
  const pending = useQuery({
    queryKey,
    queryFn: ({ signal }) => client.listInvitations({ org }, { signal }),
    retry: false,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => client.revokeInvitation({ org, id }),
    onSettled: () => cache.invalidateQueries({ queryKey }),
  });

  return (
    <Card>
      <h2 id="pending-invitations-title">Pending invitations</h2>
      {pending.isPending && <p role="status">Loading invitations…</p>}
      {pending.isError && <p role="alert">{actionError(pending.error, "Could not load invitations.")}</p>}
      {revoke.isError && <p role="alert">{actionError(revoke.error, "Could not revoke invitation.")}</p>}
      {pending.data?.invitations.length === 0 && <p>No pending invitations.</p>}
      {pending.data && pending.data.invitations.length > 0 && (
        <Table aria-labelledby="pending-invitations-title" className="members-table">
          <thead>
            <tr>
              <th scope="col">Invitation</th>
              <th scope="col">Role</th>
              <th scope="col">Expires</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pending.data.invitations.map(({ id, email, role, expiresAt }) => (
              <tr key={id}>
                <td>{email ?? "Link invitation"}</td>
                <td>{role}</td>
                <td>
                  <time dateTime={expiresAt}>{new Date(expiresAt).toLocaleDateString()}</time>
                </td>
                <td>
                  <Button
                    size="small"
                    variant="secondary"
                    disabled={!ready || revoke.isPending}
                    pending={revoke.isPending && revoke.variables === id}
                    onClick={() => revoke.mutate(id)}
                  >
                    Revoke
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function InviteDialog({ org, client, onClose }: { org: string; client: Client; onClose: () => void }) {
  const cache = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const [invitation, setInvitation] = useState<{ url: string; sentTo?: string; emailFailed?: boolean }>();
  const [error, setError] = useState<BoardError | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const role = data.get("role") === "admin" ? "admin" : "member";
    const email = String(data.get("email") ?? "").trim();
    setPending(true);
    setError(null);
    try {
      // Keep the one-time URL out of the shared mutation cache.
      const result = await client.createInvitation({ org, role, ...(email && { email }) });
      const queryKey = invitationsKey(org);
      await cache.cancelQueries({ queryKey });
      void cache.invalidateQueries({ queryKey });
      setInvitation({
        url: result.url,
        ...(result.emailSent === true && { sentTo: result.invitation.email ?? email }),
        emailFailed: result.emailSent === false,
      });
    } catch (failure) {
      setError(failure instanceof BoardError ? failure : new BoardError("unreachable", "Could not create invitation."));
    } finally {
      setPending(false);
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

function InvitationLink({ url, sentTo, emailFailed }: { url: string; sentTo?: string; emailFailed?: boolean }) {
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
        {sentTo && `Invitation emailed to ${sentTo}. `}
        {emailFailed && "The invitation email could not be sent. "}
        {sentTo ? "You can also copy the one-time link below." : "Copy this link now. It is shown only once."}
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
