import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { BoardError } from "@the-vibe-company/openboard";
import { type FormEvent, useEffect, useState } from "react";
import { browserClient } from "../api/client.ts";
import { sessionQuery } from "../api/session.ts";

export const Route = createFileRoute("/new")({ component: NewOrganization });

function NewOrganization() {
  const session = useQuery(sessionQuery);
  if (session.data?.person)
    return <OrganizationAccount key={session.data.person.principal} principal={session.data.person.principal} />;
  if (session.data) return <Navigate to="/signin" replace />;
  return <AccountStatus failed={session.isError} retry={() => void session.refetch()} />;
}

function AccountStatus({ failed, retry }: { failed: boolean; retry: () => void }) {
  return (
    <main className="sign-in">
      {failed ? (
        <section>
          <p role="alert">Could not load your account.</p>
          <button type="button" onClick={retry}>
            Try again
          </button>
        </section>
      ) : (
        <p role="status">Loading your account…</p>
      )}
    </main>
  );
}

function OrganizationAccount({ principal }: { principal: string }) {
  const account = useQuery({
    queryKey: ["account", principal],
    queryFn: ({ signal }) => browserClient(window.location.origin).getAccount({}, { signal }),
  });
  const slug = account.data?.memberships[0]?.org.slug;
  const expired = account.error instanceof BoardError && account.error.code === "unauthorized";

  useEffect(() => {
    if (expired) window.location.replace("/signin");
    else if (slug) window.location.replace(boardHref(slug, "main"));
  }, [expired, slug]);

  if (expired || slug || !account.data) {
    return <AccountStatus failed={account.isError} retry={() => void account.refetch()} />;
  }
  return (
    <OrganizationForm
      refreshAccount={async () => {
        await account.refetch();
      }}
    />
  );
}

function boardHref(org: string, board: string) {
  return `/${encodeURIComponent(org)}/${encodeURIComponent(board)}`;
}

function proposeSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 39)
    .replace(/-$/, "");
}

function OrganizationForm({ refreshAccount }: { refreshAccount: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [editedSlug, setEditedSlug] = useState<string | null>(null);
  const slug = editedSlug ?? proposeSlug(name);
  const create = useMutation({
    mutationFn: (input: { name: string; slug: string }) => browserClient(window.location.origin).createOrg(input),
    onSuccess: ({ org, board }) => window.location.assign(boardHref(org.slug, board.slug)),
    onError: async (error) => {
      if (!(error instanceof BoardError)) return;
      if (error.code === "unauthorized") window.location.replace("/signin");
      if (error.code === "already_in_org") await refreshAccount();
    },
  });
  const code = create.error instanceof BoardError ? create.error.code : undefined;
  const slugError =
    code === "slug_taken" ? `${slug} is taken` : code === "reserved_slug" ? `${slug} is reserved` : null;
  const submitting = create.isPending || create.isSuccess;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() && !submitting) create.mutate({ name: name.trim(), slug });
  }

  return (
    <main className="sign-in">
      <section aria-labelledby="new-org-title">
        <h1 id="new-org-title">Create an organization</h1>
        <form className="new-org-form" onSubmit={submit}>
          <label htmlFor="org-name">Organization name</label>
          <input
            id="org-name"
            required
            maxLength={80}
            value={name}
            disabled={submitting}
            onChange={(event) => {
              setName(event.target.value);
              create.reset();
            }}
          />
          <label htmlFor="org-slug">Slug</label>
          <input
            id="org-slug"
            required
            pattern={"x|[a-z0-9][a-z0-9\\-]{1,38}"}
            maxLength={39}
            title="Use 2–39 lowercase letters, numbers, or hyphens. Start with a letter or number."
            value={slug}
            disabled={submitting}
            aria-invalid={slugError ? true : undefined}
            aria-describedby={slugError ? "org-slug-error" : undefined}
            onChange={(event) => {
              setEditedSlug(event.target.value);
              create.reset();
            }}
          />
          {slugError && (
            <p id="org-slug-error" role="alert">
              {slugError}
            </p>
          )}
          {create.isError && !slugError && <p role="alert">Could not create your organization. Try again.</p>}
          <button type="submit" disabled={submitting || !name.trim()}>
            {submitting ? "Creating…" : "Create organization"}
          </button>
        </form>
      </section>
    </main>
  );
}
