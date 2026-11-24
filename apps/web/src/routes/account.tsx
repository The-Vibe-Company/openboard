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
        <header className="account-profile">
          <h1>Account</h1>
        </header>
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
        <Avatar name={person.name || person.handle} {...(person.avatar ? { src: person.avatar } : {})} />
        <div>
          <h1>Account</h1>
          <p className="account-handle">{person.handle}</p>
        </div>
      </header>
      <Card className="account-card" role="region" aria-labelledby="sessions-title">
        <h2 id="sessions-title">Browser sessions</h2>
        <p>
          Signed in as <strong>{person.handle}</strong>
        </p>
        <p className="account-hint">Signing out everywhere ends this account’s browser sessions on every device.</p>
        <Button variant="danger" pending={signOutEverywhere.isPending} onClick={() => signOutEverywhere.mutate(csrf)}>
          Sign out everywhere
        </Button>
        {signOutEverywhere.isError && <p role="alert">Could not sign out everywhere. Try again.</p>}
      </Card>
      <PersonalTokens key={person.principal} principal={person.principal} csrf={csrf} />
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

  let content = <p role="status">Loading personal tokens…</p>;
  if (tokens.isError) {
    content = (
      <>
        <p role="alert">Could not load your personal tokens.</p>
        <Button variant="secondary" onClick={() => void tokens.refetch()}>
          Try again
        </Button>
      </>
    );
  } else if (tokens.data?.tokens.length === 0) {
    content = <NoPersonalTokens />;
  } else if (tokens.data) {
    content = (
      <div className="account-table-scroll">
        <TokenTable
          tokens={tokens.data.tokens}
          pending={revoke.isPending}
          failedId={revoke.isError ? revoke.variables : undefined}
          onRevoke={(id) => revoke.mutate(id)}
        />
      </div>
    );
  }

  return (
    <Card className="account-card" role="region" aria-labelledby="tokens-title">
      <h2 id="tokens-title">Personal tokens</h2>
      {content}
    </Card>
  );
}

function NoPersonalTokens() {
  return (
    <EmptyState>
      <h3>No personal tokens.</h3>
      <p>
        Create one with <code>ob login &lt;origin&gt;</code> in a terminal, then approve the sign-in.
      </p>
    </EmptyState>
  );
}

type PersonalToken = Awaited<ReturnType<ReturnType<typeof browserClient>["listPersonalTokens"]>>["tokens"][number];

function TokenTable({
  tokens,
  pending,
  failedId,
  onRevoke,
}: {
  tokens: PersonalToken[];
  pending: boolean;
  failedId: string | undefined;
  onRevoke: (id: string) => void;
}) {
  return (
    <Table className="account-tokens-table" aria-labelledby="tokens-title">
      <thead>
        <tr>
          <th scope="col">Token</th>
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
            pending={pending}
            failed={failedId === token.id}
            onRevoke={() => onRevoke(token.id)}
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
      <td>
        <h3>{token.name}</h3>
      </td>
      <td>{token.org}</td>
      <td>
        <time dateTime={expiry.toISOString()}>
          <span>{expiry.toLocaleDateString()}</span> <span>{expiry.toLocaleTimeString()}</span>
        </time>
      </td>
      <td className="account-token-actions" aria-live="polite">
        <Button
          variant="danger"
          size="small"
          aria-label={revoked ? `Revoked: ${token.name}` : `Revoke ${token.name}`}
          aria-disabled={blocked}
          onClick={() => {
            if (!blocked) onRevoke();
          }}
        >
          {revoked ? "Revoked" : "Revoke"}
        </Button>
        {failed && <p role="alert">Could not revoke this token. Try again.</p>}
      </td>
    </tr>
  );
}
