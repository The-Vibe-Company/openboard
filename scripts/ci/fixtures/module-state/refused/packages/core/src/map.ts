const cache = new Map<string, number>();
const seen = new Set<string>();
const list: string[] = [];
const bag = {} as Record<string, number>;

export function remember(key: string): number | undefined {
  cache.set(key, key.length);
  seen.add(key);
  list.push(key);
  bag[key] = 1;
  return cache.get(key);
}
