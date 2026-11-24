import { Link } from "@tanstack/react-router";
import { useSignOut } from "../api/session.ts";
import { Avatar, Button } from "../ui/index.ts";
import { closeSwitcher, Switcher } from "./Switcher.tsx";
import "./UserMenu.css";

export function UserMenu({ person, csrf }: { person: { handle: string; avatar?: string | null }; csrf: string }) {
  const signOut = useSignOut();
  return (
    <div className="shell-user">
      <Switcher
        label="User menu"
        alignEnd
        trigger={
          <>
            <Avatar name={person.handle} src={person.avatar ?? undefined} />
            <span className="shell-user-handle">{person.handle}</span>
          </>
        }
      >
        <Link to="/account" onClick={closeSwitcher}>
          Account
        </Link>
        <Button variant="tertiary" pending={signOut.isPending} onClick={() => signOut.mutate(csrf)}>
          Sign out
        </Button>
        {signOut.isError && <p role="alert">Could not sign out. Try again.</p>}
      </Switcher>
    </div>
  );
}
