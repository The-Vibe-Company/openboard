import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { BoardError } from "@the-vibe-company/openboard";
import { type FormEvent, useEffect, useState } from "react";
import { browserClient } from "../api/client.ts";
import { sessionQuery } from "../api/session.ts";
import { AuthPage } from "../components/AuthPage.tsx";
import { Button, Field, Input } from "../ui/index.ts";

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
    <AuthPage title="Create an organization" description="Set up a shared space for your team and agents.">
      {failed ? (
        <>
          <p role="alert">Could not load your account.</p>
          <Button type="button" onClick={retry}>
            Try again
          </Button>
        </>
      ) : (
        <p role="status">Loading your account…</p>
      )}
    </AuthPage>
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
  }, [expired]);

  if (slug && !expired) return <Navigate to="/$org/$board" params={{ org: slug, board: "main" }} replace />;

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

const slugFormat = "Use 2–39 lowercase letters, numbers, or hyphens. Start with a letter or number.";

function OrganizationForm({ refreshAccount }: { refreshAccount: () => Promise<void> }) {
  const { data: session } = useQuery(sessionQuery);
  const [name, setName] = useState("");
  const [editedSlug, setEditedSlug] = useState<string | null>(null);
  const [slugValidationError, setSlugValidationError] = useState<string | null>(null);
  const slug = editedSlug ?? proposeSlug(name);
  const create = useMutation({
    mutationFn: (input: { name: string; slug: string }) =>
      browserClient(window.location.origin, { csrf: session?.csrf ?? undefined }).createOrg(input),
    onSuccess: ({ org, board }) => window.location.assign(boardHref(org.slug, board.slug)),
    onError: async (error) => {
      if (!(error instanceof BoardError)) return;
      if (error.code === "unauthorized") window.location.replace("/signin");
      if (error.code === "already_in_org") await refreshAccount();
    },
  });
  const code = create.error instanceof BoardError ? create.error.code : undefined;
  const slugError =
    code === "slug_taken" ? `${slug} is taken` : code === "reserved_slug" ? `${slug} is reserved` : slugValidationError;
  const submitting = create.isPending || create.isSuccess;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() && !submitting) create.mutate({ name: name.trim(), slug });
  }

  return (
    <AuthPage title="Create an organization" description="Set up a shared space for your team and agents.">
      <form onSubmit={submit}>
        <Field label="Organization name">
          {(props) => (
            <Input
              {...props}
              required
              maxLength={80}
              value={name}
              disabled={submitting}
              onChange={(event) => {
                setName(event.target.value);
                if (editedSlug === null) setSlugValidationError(null);
                create.reset();
              }}
            />
          )}
        </Field>
        <Field label="Slug" error={slugError && <span role="alert">{slugError}</span>}>
          {(props) => (
            <Input
              {...props}
              required
              pattern={"x|[a-z0-9][a-z0-9\\-]{1,38}"}
              maxLength={39}
              title={slugFormat}
              value={slug}
              onInvalid={(event) => {
                event.preventDefault();
                setSlugValidationError(
                  event.currentTarget.validity.valueMissing ? "Enter an organization slug." : slugFormat,
                );
                event.currentTarget.focus();
              }}
              disabled={submitting}
              onChange={(event) => {
                setEditedSlug(event.target.value);
                setSlugValidationError(null);
                create.reset();
              }}
            />
          )}
        </Field>
        {create.isError && !slugError && <p role="alert">Could not create your organization. Try again.</p>}
        <Button type="submit" pending={submitting} disabled={!name.trim()}>
          {submitting ? "Creating…" : "Create organization"}
        </Button>
      </form>
    </AuthPage>
  );
}
