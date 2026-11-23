export let count = 0;
export var total = 0;

export function bump(): number {
  count += 1;
  total += 1;
  return count + total;
}
