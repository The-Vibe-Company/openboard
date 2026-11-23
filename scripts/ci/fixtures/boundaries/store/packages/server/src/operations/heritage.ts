import type * as Ports from "@openboard/ports";

export interface StoreForFixture extends Ports.Store {
  readonly fixture: true;
}
