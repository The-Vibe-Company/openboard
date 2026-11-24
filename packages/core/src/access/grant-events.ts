import type { GrantView } from "@openboard/contract";

export interface GrantCreated {
  readonly id: number;
  readonly type: "ob.grant.created";
  readonly at: number;
  readonly thread: null;
  readonly message: null;
  readonly channel: null;
  readonly actor: string;
  readonly principal: string;
  readonly visibility: 2;
  readonly payload: { readonly grant: GrantView };
}
