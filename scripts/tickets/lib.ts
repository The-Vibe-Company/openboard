const stateLabels = ["ready", "claimed", "review", "blocked"];

export function parseTicket(path: string, source: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(source);
  if (!match?.[1] || match[2] === undefined) {
    throw new Error(`${path}: expected ticket front matter and body`);
  }
  const [, frontMatter, body] = match;
  const fields = new Map(
    Array.from(frontMatter.matchAll(/^([a-z_]+):[ \t]*(.*)$/gm), ([, key, value]) => [
      key,
      value?.replace(/[ \t]+#.*$/, "").trim(),
    ]),
  );
  const title = fields.get("title");
  const milestone = fields.get("milestone");
  const milestoneParts = /^(M\d+)-([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(milestone ?? "");
  const packageName = fields.get("package");
  const status = fields.get("status") ?? "";
  const issueValue = fields.get("issue") ?? "";
  if (
    !title ||
    !milestoneParts?.[1] ||
    !milestoneParts[2] ||
    !packageName ||
    ![...stateLabels, "draft", "done", "dropped"].includes(status) ||
    !/^(null|[1-9]\d*)$/.test(issueValue)
  ) {
    throw new Error(`${path}: invalid title, milestone, package, status or issue field`);
  }

  const milestoneLabel = milestoneParts[1];
  const milestoneName = milestoneParts[2].replaceAll("-", " ");
  const labels = [`pkg:${packageName}`, milestoneLabel];
  if (stateLabels.includes(status)) labels.push(status);
  if (fields.get("conformance") && fields.get("conformance") !== "[]") labels.push("conformance");
  const writes = /^writes:\r?\n((?:[ \t]+- .*\r?\n)*)/m.exec(frontMatter)?.[1] ?? "";
  const id = fields.get("id") ?? "";
  if (!/^\d+$/.test(id)) throw new Error(`${path}: invalid id field`);
  if (
    /^[ \t]+- (?:packages\/server\/(?:src\/http\/scope\.ts|test\/isolation\/)|packages\/ports\/testkit\/isolation)/m.test(
      writes,
    ) ||
    /\blabel `isolation`/.test(body)
  ) {
    labels.push("isolation");
  }
  if (/^[ \t]+- tools\/bench\/budgets\.json\s*$/m.test(writes)) labels.push("perf");

  return {
    path,
    source,
    id: Number(id),
    title,
    status,
    claimedBy: fields.get("claimed_by") ?? "null",
    writes: Array.from(writes.matchAll(/^[ \t]+- (.*)$/gm), ([, glob]) =>
      (glob ?? "").replace(/[ \t]+#.*$/, "").trim(),
    ),
    body: body.trim(),
    marker: `<!-- openboard-ticket: ${path} -->`,
    milestoneTitle: `${milestoneLabel} ${milestoneName[0]?.toUpperCase()}${milestoneName.slice(1)}`,
    labels,
    issue: issueValue === "null" ? null : Number(issueValue),
  };
}

export function updateIssueNumber(source: string, number: number) {
  const end = source.indexOf("\n---", 3);
  return (
    source
      .slice(0, end)
      .replace(/^issue:[ \t]*null(?:[ \t]+#[^\r\n]*)?[ \t]*\r?$/m, (line) => line.replace("null", String(number))) +
    source.slice(end)
  );
}

export function isManagedLabel(name: string) {
  return name.startsWith("pkg:") || /^M\d+$/.test(name) || stateLabels.includes(name);
}

export function setClaim(source: string, agent: string) {
  const end = source.indexOf("\n---", 3);
  let replaced = 0;
  const set = (value: string) => (_: string, key: string) => {
    replaced += 1;
    return key + value;
  };
  const claimed = source
    .slice(0, end)
    .replace(/^(status:[ \t]*)ready(?=[ \t]|\r?$)/m, set("claimed"))
    .replace(/^(claimed_by:[ \t]*)null(?=[ \t]|\r?$)/m, set(agent));
  if (replaced !== 2) throw new Error("expected `status: ready` and `claimed_by: null` in the front matter");
  return claimed + source.slice(end);
}

type Token = string;

// True when some path is matched by both globs: `**` spans any number of segments, `*` any
// characters within a segment, `?` one character. Other glob syntax is refused, not guessed.
export function globsOverlap(a: string, b: string): boolean {
  for (const glob of [a, b]) {
    const parts = glob.replace(/\/$/, "").split("/");
    if (/[[\]{}!\\]/.test(glob) || parts.some((segment) => ["", ".", ".."].includes(segment))) {
      throw new Error(`unsupported writes glob: ${JSON.stringify(glob)}`);
    }
  }
  const segments = (glob: string) => glob.replace(/\/$/, "/**").split("/");
  return intersects(segments(a), segments(b), "**", (x, y) => intersects([...x], [...y], "*", charsMatch));
}

function charsMatch(x: Token, y: Token) {
  return x === y || x === "?" || y === "?";
}

function intersects(a: Token[], b: Token[], star: Token, match: (x: Token, y: Token) => boolean) {
  const normalize = (tokens: Token[]) =>
    tokens.map((token) => (star === "**" && token !== "**" ? token.replace(/\*+/g, "*") : token));
  const left = normalize(a);
  const right = normalize(b);
  const seen = new Map<string, boolean>();
  const visit = (i: number, j: number): boolean => {
    const key = `${i},${j}`;
    const known = seen.get(key);
    if (known !== undefined) return known;
    seen.set(key, false);
    const x = left[i];
    const y = right[j];
    let result: boolean;
    if (x === star) result = visit(i + 1, j) || (y !== undefined && visit(i, j + 1));
    else if (y === star) result = visit(i, j + 1) || (x !== undefined && visit(i + 1, j));
    else if (x === undefined || y === undefined) result = x === y;
    else result = match(x, y) && visit(i + 1, j + 1);
    seen.set(key, result);
    return result;
  };
  return visit(0, 0);
}
