import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { sessionQuery } from "../api/session.ts";
import { AuthPage } from "../components/AuthPage.tsx";
import { Button } from "../ui/index.ts";

export const Route = createFileRoute("/signin")({ component: SignIn });

function SignIn() {
  const { data: session, isError, refetch } = useQuery(sessionQuery);
  if (session?.signedIn) return <Navigate to="/" replace />;

  return (
    <AuthPage title="Sign in" description="Continue to your OpenBoard account.">
      {session ? (
        session.providers.length > 0 ? (
          <div className="auth-actions">
            {session.providers.map((provider) => (
              <Button key={provider.id} type="button" onClick={() => window.location.assign(provider.start)}>
                Continue with {provider.id === "github" ? "GitHub" : provider.id}
              </Button>
            ))}
          </div>
        ) : (
          <p>No sign-in is configured on this server</p>
        )
      ) : isError ? (
        <>
          <p role="alert">Could not load sign-in options.</p>
          <Button type="button" onClick={() => void refetch()}>
            Try again
          </Button>
        </>
      ) : (
        <p role="status">Loading sign-in options…</p>
      )}
    </AuthPage>
  );
}
