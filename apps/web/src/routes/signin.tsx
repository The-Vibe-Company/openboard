import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { sessionQuery } from "../api/session.ts";

export const Route = createFileRoute("/signin")({ component: SignIn });

function SignIn() {
  const { data: session, isError, refetch } = useQuery(sessionQuery);
  if (session?.signedIn) return <Navigate to="/" replace />;

  return (
    <main className="sign-in">
      <section aria-labelledby="sign-in-title">
        <h1 id="sign-in-title">Sign in</h1>
        {session ? (
          session.providers.length > 0 ? (
            <div className="provider-buttons">
              {session.providers.map((provider) => (
                <button key={provider.id} type="button" onClick={() => window.location.assign(provider.start)}>
                  Continue with {provider.id === "github" ? "GitHub" : provider.id}
                </button>
              ))}
            </div>
          ) : (
            <p>No sign-in is configured on this server</p>
          )
        ) : isError ? (
          <>
            <p role="alert">Could not load sign-in options.</p>
            <button type="button" onClick={() => void refetch()}>
              Try again
            </button>
          </>
        ) : (
          <p role="status">Loading sign-in options…</p>
        )}
      </section>
    </main>
  );
}
