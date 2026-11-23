import * as all from "./registry.ts";
import { Holder, installed, registry as names } from "./registry.ts";

export function use(name: string): void {
  names.set(name, 1);
  installed.push(name);
  Holder.items.add(name);
  all.registry.clear();
}
