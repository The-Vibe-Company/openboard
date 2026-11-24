import { BoardError, type explainGrants, type GrantView, type InputOf } from "@openboard/contract";
import { agents, explainAccess, explainSubject, type GrantSubject, grants } from "@openboard/core";
import { callerCan, credentialKind, memberOf, requestScope, workloadOf } from "../../deps.ts";
import type { Handler } from "../index.ts";
import { canListGrants } from "./list.ts";

type Query = InputOf<typeof explainGrants>;
type Context = Parameters<Handler<typeof explainGrants>>[0];

function subjectOf(query: Query): GrantSubject | undefined {
  const { project, environment, app, github, workflow, branch, event, oidc, claim } = query;
  if ((environment && !project) || ((workflow || branch || event) && !github) || (claim && !oidc)) {
    throw new BoardError("invalid_request", "explain selectors need their matching principal");
  }
  if (project) return { kind: "project", id: project, environment: environment ?? "production" };
  if (app) return { kind: "app", id: app };
  if (github)
    return {
      kind: "github",
      repository: github,
      repositoryId: null,
      event,
      workflow: workflow && (workflow.includes("/") ? workflow : `.github/workflows/${workflow}`),
      branch: branch?.replace(/^refs\/heads\//, ""),
    };
  if (oidc) {
    const claims = new Map<string, string>();
    for (const entry of claim ?? []) {
      const at = entry.indexOf("=");
      const name = entry.slice(0, at);
      if (at < 1 || at === entry.length - 1 || claims.has(name)) {
        throw new BoardError("invalid_request", "each claim needs a distinct name=value");
      }
      claims.set(name, entry.slice(at + 1));
    }
    return { kind: "oidc", issuer: oidc, claims: Object.fromEntries(claims) };
  }
}

async function explainPerson(ctx: Context, channel: string, person: string, views: GrantView[], self: boolean) {
  const role = self ? ctx.by[memberOf]?.role : (await ctx.board.member(person))?.role;
  if (!role) throw new BoardError("not_found", "no such board member");
  const active = await ctx.board.personGrants(person);
  const byId = new Map(views.map((view) => [view.id, view]));
  const candidates = active
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
    .map((grant) => ({ ...grant, view: byId.get(grant.id) }));
  return explainAccess(channel, candidates, role);
}

export const explainGrantsHandler: Handler<typeof explainGrants> = async (ctx, query) => {
  const { by } = ctx;
  const { channel, connection, user } = query;
  const person = by[memberOf] && by.principal.slice("ob:user:".length);
  const kind = by[credentialKind];
  const canList = kind !== "agent" && canListGrants(by);
  const selectors = [user, query.project, query.github, query.oidc, query.app, connection].filter(Boolean);
  const self = selectors.length === 0 || (selectors.length === 1 && user !== undefined && user === person);
  if (!self && !canList) throw new BoardError("forbidden", "explaining someone else needs manage at *");
  if (selectors.length > 1) throw new BoardError("invalid_request", "explain takes one principal");
  const named = subjectOf(query);
  if (connection !== undefined) {
    if (!(await ctx.board.connection(connection))) return explainAccess(channel, []);
    const views = await ctx.board.listGrants();
    // Revocation can commit between the initial lookup and the grant read.
    if (!(await ctx.board.connection(connection))) return explainAccess(channel, []);
    return explainSubject(channel, views, { kind: "connection", id: connection });
  }
  if (self && kind === "local") {
    const can = by[requestScope] === undefined ? grants.PERMISSIONS : agents.allowedAt(by[callerCan] ?? {}, channel);
    return { ...explainAccess(channel, []), can: [...can] };
  }
  const subject =
    named ??
    by[workloadOf] ??
    (kind === "connection" || kind === "agent"
      ? ({ kind: "connection", id: by.principal.slice("ob:conn:".length) } as const)
      : undefined);
  const views = subject || canList ? await ctx.board.listGrants() : [];
  if (user || (self && person)) {
    const explanation = await explainPerson(ctx, channel, user ?? person ?? "", views, self);
    if (self) explanation.can = [...agents.allowedAt(by[callerCan] ?? {}, channel)];
    if (!canList) explanation.grants = [];
    return explanation;
  }
  const explanation = subject ? explainSubject(channel, views, subject) : explainAccess(channel, []);
  if (self) explanation.can = [...agents.allowedAt(by[callerCan] ?? {}, channel)];
  if (!canList) explanation.grants = [];
  return explanation;
};
