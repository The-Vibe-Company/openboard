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
    title,
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
