import { type Static, type TLiteral, type TProperties, Type } from "@sinclair/typebox";
import { Ref } from "../operation.ts";
import { CanInput } from "./connections.ts";

function principal<K extends string, P extends TProperties>(kind: K, properties: P) {
  return Type.Object({ kind: Type.Literal(kind), ...properties } as { kind: TLiteral<K> } & P, {
    additionalProperties: false,
  });
}

const Name = Type.String({ minLength: 1, maxLength: 512 });
const Environments = Type.Array(Name);
const NullableName = Type.Union([Type.String(), Type.Null()]);
const GitHubFields = {
  repository: Name,
  workflow: Type.Optional(Name),
  branch: Type.Optional(Name),
  event: Type.Optional(Name),
};
const ClaimValue = Type.String({ minLength: 1, maxLength: 1000 });
const Oidc = principal("oidc", {
  issuer: Name,
  claims: Type.Record(Type.String(), Type.Union([ClaimValue, Type.Array(ClaimValue, { minItems: 1 })])),
});
const Groups = [
  principal("all-users", {}),
  principal("all-apps", {}),
  principal("everyone", {}),
  principal("all-connections", {}),
] as const;

export const GrantPrincipalInput = Type.Union([
  principal("user", { userId: Ref("member") }),
  principal("project", { project: Name, environments: Environments }),
  principal("all-projects", { environments: Environments }),
  principal("github", GitHubFields),
  Oidc,
  principal("app", { app: Name }),
  principal("connection", { connection: Ref("connection") }),
  ...Groups,
]);
export type GrantPrincipalInput = Static<typeof GrantPrincipalInput>;

export const GrantPrincipal = Type.Union([
  principal("user", { userId: Type.String(), email: NullableName }),
  principal("project", { projectId: Name, name: NullableName, environments: Environments, teamId: NullableName }),
  principal("all-projects", { environments: Environments }),
  principal("github", { ...GitHubFields, repositoryId: NullableName }),
  Oidc,
  principal("app", { clientId: Name, name: NullableName }),
  principal("connection", { connection: Type.String() }),
  ...Groups,
]);
export type GrantPrincipal = Static<typeof GrantPrincipal>;

export const GrantView = Type.Object({
  id: Type.String(),
  principals: Type.Array(GrantPrincipal),
  can: CanInput,
  capped: Type.Boolean(),
  by: NullableName,
  at: NullableName,
});
export type GrantView = Static<typeof GrantView>;
