const credentialFields = Object.freeze([
  "authorization",
  "claimkey",
  "claimtoken",
  "clientsecret",
  "cookie",
  "csrf",
  "encryptedsecret",
  "idhash",
  "jwk",
  "jwks",
  "keymaterial",
  "keysjson",
  "password",
  "passwordhash",
  "previoushash",
  "prevhash",
  "prevsecrethash",
  "privatekey",
  "secret",
  "secrethash",
  "secrethint",
  "session",
  "sessionhash",
  "sessionid",
  "sessiontoken",
  "signingkey",
  "signingsecret",
  "signingsecrethash",
  "token",
  "tokenhash",
]);

const isCredentialField = (name: string) => credentialFields.includes(name.replace(/[_-]/g, "").toLowerCase());

function containsCredentialField(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.entries(value).some(([name, child]) => isCredentialField(name) || containsCredentialField(child))
  );
}

function stripCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripCredentials);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([name]) => !isCredentialField(name))
      .map(([name, child]) => [name, stripCredentials(child)]),
  );
}

/** Apply the same credential filter to every stored event payload, regardless of event type. */
export function exportEvent(event: object): object {
  if (!("payload" in event)) return event;
  const payload = stripCredentials(event.payload);
  if (
    "type" in event &&
    (event.type === "ob.grant.created" ||
      event.type === "ob.grant.updated" ||
      event.type === "ob.connection.created") &&
    event.payload &&
    typeof event.payload === "object" &&
    "grant" in event.payload &&
    containsCredentialField(event.payload.grant)
  ) {
    const scoped = payload as { grant: object; connection?: object };
    // Dropping an OIDC predicate or a channel override can widen access on
    // replay. Retain the sanitized record while giving the grant no permissions.
    return {
      ...event,
      payload: {
        ...scoped,
        grant: { ...scoped.grant, can: {}, recreate: true },
        ...(scoped.connection && { connection: { ...scoped.connection, can: {} } }),
      },
    };
  }
  return { ...event, payload };
}
