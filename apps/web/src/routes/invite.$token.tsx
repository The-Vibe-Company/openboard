import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BoardError } from "@the-vibe-company/openboard";
import { browserClient } from "../api/client.ts";
import { sessionQuery } from "../api/session.ts";
import { AuthPage } from "../components/AuthPage.tsx";
import { Button } from "../ui/index.ts";

export const Route = createFileRoute("/invite/$token")({
  validateSearch: (search: Record<string, unknown>) => ({
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  component: InvitationPage,
});

function invalidInvitation(code: string | undefined) {
  return code === "not_found" || code === "invitation_used";
}

function joinError(code: string | undefined) {
  if (code === "already_in_org") return "You already belong to an organization. You can only join one.";
  if (code === "invitation_email_mismatch") return "This invitation was sent to a different email address.";
  if (code === "quota_exceeded") return "This organization has reached its member limit.";
  return "Could not join the organization. Try again.";
}

function errorCode(error: unknown) {
  return error instanceof BoardError ? error.code : undefined;
}

function InvitationPage() {
  const { token } = Route.useParams();
  const { error } = Route.useSearch();
  return <Invitation key={token} token={token} signInError={error} />;
}

function Invitation({ token, signInError }: { token: string; signInError: string | undefined }) {
  const validToken = /^[A-Za-z0-9_-]{43}$/.test(token);
  const preview = useQuery({
    queryKey: ["invitation", token],
    queryFn: ({ signal }) => browserClient(window.location.origin).previewInvitation({ token }, { signal }),
    enabled: validToken,
    retry: (attempt, error) => !invalidInvitation(errorCode(error)) && attempt < 2,
  });
  const session = useQuery(sessionQuery);
  const join = useMutation({
    mutationFn: () => browserClient(window.location.origin).acceptInvitation({ token }),
    onSuccess: ({ org }) => window.location.replace(`/${encodeURIComponent(org.slug)}/main`),
  });
  const invite = preview.data;
  const account = session.data;
  const github = account?.providers.some(({ id }) => id === "github");
  const joinCode = errorCode(join.error);
  const returnError =
    account?.signedIn && !join.isPending && !join.isError && !invalidInvitation(signInError) ? signInError : undefined;
  const invalid = !validToken || [errorCode(preview.error), joinCode].some(invalidInvitation);

  return (
    <AuthPage title="Organization invitation" description="Review your invitation before joining the organization.">
      {invalid ? (
        <p role="alert">This invitation is no longer valid</p>
      ) : preview.isError || session.isError ? (
        <>
          <p role="alert">Could not load the invitation. Try again.</p>
          <Button type="button" onClick={() => void Promise.all([preview.refetch(), session.refetch()])}>
            Try again
          </Button>
        </>
      ) : invite && account ? (
        <>
          <h2>{invite.orgName}</h2>
          <p>Role: {invite.role}</p>
          <p>
            Expires: <time dateTime={invite.expiresAt}>{new Date(invite.expiresAt).toLocaleString()}</time>
          </p>
          {account.signedIn ? (
            <Button type="button" pending={join.isPending || join.isSuccess} onClick={() => join.mutate()}>
              Join {invite.orgName}
            </Button>
          ) : github ? (
            <a className="auth-link" href={`/auth/github/start?${new URLSearchParams({ invitation: token })}`}>
              Sign in with GitHub to join
            </a>
          ) : (
            <p>No sign-in is configured on this server</p>
          )}
          {(join.isError || returnError) && <p role="alert">{joinError(joinCode ?? returnError)}</p>}
        </>
      ) : (
        <p role="status">Loading invitation…</p>
      )}
    </AuthPage>
  );
}
