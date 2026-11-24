import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BoardError, type ErrorCode } from "@the-vibe-company/openboard";
import { useState } from "react";
import { browserClient } from "../api/client.ts";
import { sessionQuery } from "../api/session.ts";
import "./device.css";

export const Route = createFileRoute("/device")({ component: Device });

function Device() {
  const session = useQuery(sessionQuery);
  return (
    <main className="sign-in device-sign-in">
      <section aria-labelledby="device-title">
        <h1 id="device-title">Approve a terminal sign-in</h1>
        {session.isError ? (
          <p role="alert">Could not load your session.</p>
        ) : !session.data ? (
          <p role="status">Loading your session…</p>
        ) : session.data.signedIn && session.data.person && session.data.csrf ? (
          <DeviceApproval
            key={session.data.person.principal}
            principal={session.data.person.principal}
            csrf={session.data.csrf}
          />
        ) : (
          <Link to="/signin">Sign in to approve</Link>
        )}
      </section>
    </main>
  );
}

function hasErrorCode(error: unknown, ...codes: ErrorCode[]) {
  return error instanceof BoardError && codes.includes(error.code);
}

function DeviceApproval({ principal, csrf }: { principal: string; csrf: string }) {
  const client = browserClient(window.location.origin, { csrf });
  const account = useQuery({
    queryKey: ["device-account", principal],
    queryFn: async ({ signal }) => {
      const result = await client.getAccount({}, { signal });
      if (result.person.principal !== principal) throw new BoardError("unauthorized", "the browser session changed");
      return result;
    },
  });
  const preview = useMutation({
    mutationFn: async (userCode: string) => ({ userCode, ...(await client.previewDeviceSignIn({ userCode })) }),
  });
  const approve = useMutation({
    mutationFn: (input: { userCode: string; org: string }) => client.approveDeviceSignIn(input),
  });
  const org = account.isSuccess ? account.data.memberships[0]?.org : undefined;
  const busy = preview.isPending || approve.isPending;
  const invalid = [preview.error, approve.error].some((error) => hasErrorCode(error, "not_found", "invalid_request"));
  const request = preview.data;
  const confirmation = request && org && !invalid;
  const sessionChanged = hasErrorCode(approve.error, "unauthorized", "forbidden");

  if (approve.isSuccess) return <p role="status">Sign-in approved. Return to your terminal.</p>;

  return (
    <>
      <DeviceCodeForm
        disabled={busy}
        onCheck={(userCode) => {
          approve.reset();
          preview.mutate(userCode);
        }}
        onEdit={() => {
          preview.reset();
          approve.reset();
        }}
      />
      {account.isError && <p role="alert">Could not load your organization.</p>}
      {account.isSuccess && !org && <p>Join or create an organization before approving a sign-in.</p>}
      {invalid && <p role="alert">This code is not valid</p>}
      {preview.isError && !invalid && <p role="alert">Could not check the code. Try again.</p>}
      <div aria-live="polite" aria-atomic="true">
        {confirmation && (
          <>
            <p>Confirm that the code and client name match your terminal.</p>
            <dl>
              <dt>Code</dt>
              <dd>{request.userCode}</dd>
              <dt>Client</dt>
              <dd>{request.clientName}</dd>
              <dt>Organization</dt>
              <dd>
                {org.name} ({org.slug})
              </dd>
            </dl>
          </>
        )}
      </div>
      {confirmation && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => approve.mutate({ userCode: request.userCode, org: org.slug })}
          >
            Approve
          </button>
          {approve.isError && (
            <p role="alert">
              {sessionChanged
                ? "Could not approve with this session. Reload the page and check the code again."
                : "Could not approve the sign-in. Try again."}
            </p>
          )}
        </>
      )}
    </>
  );
}

function DeviceCodeForm({
  disabled,
  onCheck,
  onEdit,
}: {
  disabled: boolean;
  onCheck: (code: string) => void;
  onEdit: () => void;
}) {
  const [code, setCode] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onCheck(code.trim().toUpperCase());
      }}
    >
      <label htmlFor="device-code">User code</label>
      <input
        id="device-code"
        value={code}
        required
        maxLength={19}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        onChange={(event) => {
          setCode(event.target.value);
          onEdit();
        }}
      />
      <button type="submit" disabled={disabled || !code.trim()}>
        Check code
      </button>
    </form>
  );
}
