import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { sessionQuery, useSignOut } from "../api/session.ts";

export function Header() {
  const { data: session } = useQuery(sessionQuery);
  const { person, csrf } = session ?? {};
  const signOut = useSignOut();

  return (
    <header className="site-header">
      <Link to="/">OpenBoard</Link>
      {person && csrf ? (
        <div className="session-controls">
          {person.avatar && <img src={person.avatar} alt="" width={32} height={32} />}
          <span>{person.handle}</span>
          <button type="button" disabled={signOut.isPending} onClick={() => signOut.mutate(csrf)}>
            Sign out
          </button>
          {signOut.isError && <span role="alert">Could not sign out. Try again.</span>}
        </div>
      ) : session ? (
        <Link to="/signin">Sign in</Link>
      ) : null}
    </header>
  );
}
