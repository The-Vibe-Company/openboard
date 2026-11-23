// Outside a `src` directory: not covered by the rule.
export let outside = 0;
export function bump(): number {
  outside += 1;
  return outside;
}
