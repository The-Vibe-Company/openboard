// Exported containers are refused when an importing file changes them.
export const registry = new Map<string, number>();
const hooks: string[] = [];
export { hooks as installed };

export class Holder {
  static readonly items = new Set<string>();

  readonly name = "holder";
}
