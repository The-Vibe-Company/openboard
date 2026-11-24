import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { BoardError } from "@the-vibe-company/openboard";
import { browserClient } from "../api/client.ts";
import { sessionQuery } from "../api/session.ts";
import { Avatar, Button, Card, EmptyState, Table } from "../ui/index.ts";
import "./account.css";

export const Route = createFileRoute("/account")({ component: Account });

const sessionRejected = (error: unknown) =>
  error instanceof BoardError && (error.code === "unauthorized" || error.code === "forbidden");

function Account() {
  const session = useQuery(sessionQuery);
  const cache = useQueryClient();
  const signOutEverywhere = useMutation({
    mutationFn: (csrf: string) => browserClient(window.location.origin, { csrf }).revokeAllSessions({}),
    onSuccess: async () => {
      await cache.cancelQueries(sessionQuery);
      cache.setQueryData(
        sessionQuery.queryKey,
        (current) => current && { ...current, signedIn: false, person: null, csrf: null },
      );
    },
    onError: (error) => {
      if (sessionRejected(error)) return cache.invalidateQueries(sessionQuery);
    },
  });

  if (session.isError) {
    return (
      <main className="account">
        <h1>Account</h1>
        <p role="alert">Could not load your account.</p>
        <Button variant="secondary" onClick={() => void session.refetch()}>
          Try again
        </Button>
      </main>
    );
  }
  if (!session.data)
    return (
      <main className="account">
        <p role="status">Loading your account…</p>
      </main>
    );
  const { person, csrf } = session.data;
  if (!person || !csrf) return <Navigate to="/signin" replace />;

  return (
    <main className="account">
      <header className="account-profile">
        <Avatar name={person.handle} src={person.avatar ?? undefined} />
        <div>
          <h1>Account</h1>
          <p>
            Signed in as <strong>{person.handle}</strong>
          </p>
        </div>
      </header>
      <Card role="region" aria-labelledby="sessions-title">
        <h2 id="sessions-title">Browser sessions</h2>
        <Button variant="danger" pending={signOutEverywhere.isPending} onClick={() => signOutEverywhere.mutate(csrf)}>
          Sign out everywhere
        </Button>
        {signOutEverywhere.isError && <p role="alert">Could not sign out everywhere. Try again.</p>}
      </Card>
      <Card role="region" aria-labelledby="tokens-title">
        <h2 id="tokens-title">Personal tokens</h2>
        <PersonalTokens key={person.principal} principal={person.principal} csrf={csrf} />
      </Card>
    </main>
  );
}

function PersonalTokens({ principal, csrf }: { principal: string; csrf: string }) {
  const cache = useQueryClient();
  const client = browserClient(window.location.origin, { csrf });
  const queryKey = ["personal-tokens", principal];
  const tokens = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      // The session cookie can change while this page still shows the previous person.
      const checkSession = async () => {
        const current = await client.getSession({}, { signal });
        if (current.csrf !== csrf) throw new BoardError("unauthorized", "The browser session changed.");
      };
      try {
        await checkSession();
        const result = await client.listPersonalTokens({}, { signal });
        await checkSession();
        return result;
      } catch (error) {
        if (sessionRejected(error)) void cache.invalidateQueries(sessionQuery);
        throw error;
      }
    },
    retry: false,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => client.revokePersonalToken({ id }),
    onSuccess: async ({ id, revokedAt }) => {
      await cache.cancelQueries({ queryKey });
      cache.setQueryData<typeof tokens.data>(
        queryKey,
        (data) => data && { tokens: data.tokens.map((token) => (token.id === id ? { ...token, revokedAt } : token)) },
      );
    },
    onError: (error) => {
      if (sessionRejected(error)) return cache.invalidateQueries(sessionQuery);
    },
  });

  if (tokens.isError) {
    return (
      <>
        <p role="alert">Could not load your personal tokens.</p>
        <Button variant="secondary" onClick={() => void tokens.refetch()}>
          Try again
        </Button>
      </>
    );
  }
  if (!tokens.data) return <p role="status">Loading personal tokens…</p>;
  if (tokens.data.tokens.length === 0) {
    return (
      <EmptyState>
        <p>No personal tokens.</p>
        <p>
          Run <code>ob login</code> in your terminal to create one.
        </p>
      </EmptyState>
    );
  }
  return <PersonalTokenTable tokens={tokens.data.tokens} revoke={revoke} />;
}

type PersonalToken = Awaited<ReturnType<ReturnType<typeof browserClient>["listPersonalTokens"]>>["tokens"][number];

function PersonalTokenTable({
  tokens,
  revoke,
}: {
  tokens: PersonalToken[];
  revoke: {
    isPending: boolean;
    isError: boolean;
    variables: string | undefined;
    mutate: (id: string) => void;
  };
}) {
  return (
    <Table aria-labelledby="tokens-title">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Organization</th>
          <th scope="col">Expires</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {tokens.map((token) => (
          <PersonalTokenRow
            key={token.id}
            token={token}
            pending={revoke.isPending}
            failed={revoke.isError && revoke.variables === token.id}
            onRevoke={() => revoke.mutate(token.id)}
          />
        ))}
      </tbody>
    </Table>
  );
}

function PersonalTokenRow({
  token,
  pending,
  failed,
  onRevoke,
}: {
  token: PersonalToken;
  pending: boolean;
  failed: boolean;
  onRevoke: () => void;
}) {
  const expiry = new Date(token.expiresAt);
  const revoked = token.revokedAt !== null;
  const blocked = pending || revoked;
  return (
    <tr>
      <th scope="row">
        <h3>{token.name}</h3>
      </th>
      <td>{token.org}</td>
      <td>
        <time dateTime={expiry.toISOString()}>
          {expiry.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })}
        </time>
      </td>
      <td>
        <div aria-live="polite">
          <Button
            variant="secondary"
            size="small"
            aria-label={revoked ? `Revoked: ${token.name}` : `Revoke ${token.name}`}
            aria-disabled={blocked}
            onClick={() => {
              if (!blocked) onRevoke();
            }}
          >
            {revoked ? "Revoked" : "Revoke"}
          </Button>
        </div>
        {failed && <p role="alert">Could not revoke this token. Try again.</p>}
      </td>
    </tr>
  );
}
