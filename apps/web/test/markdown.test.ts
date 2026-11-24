import { expect, test } from "bun:test";
import { markdownPreview, renderMarkdown } from "../src/markdown.ts";

function element(type: string, children: unknown, props = {}) {
  return { type, props: { ...props, children } };
}

test("formats paragraphs, emphasis, code, lists and HTTPS links", () => {
  const text = [
    "A **bold**, _quiet_ paragraph with `x < y`.",
    "",
    "[Help](https://example.com/help)",
    "",
    "```ts",
    "  **literal**",
    "",
    "  x < y",
    "```",
    "",
    "- one",
    "- **two**",
    "",
    "3. three",
    "4. four",
  ].join("\n");
  expect(renderMarkdown(text)).toMatchObject([
    element("p", [
      "A ",
      element("strong", ["bold"]),
      ", ",
      element("em", ["quiet"]),
      " paragraph with ",
      element("code", "x < y"),
      ".",
    ]),
    element("p", [
      element("a", "Help", {
        href: "https://example.com/help",
        target: "_blank",
        rel: "noopener noreferrer nofollow",
      }),
    ]),
    element("pre", element("code", "  **literal**\n\n  x < y")),
    element("ul", [element("li", ["one"]), element("li", [element("strong", ["two"])])]),
    element("ol", [element("li", ["three"]), element("li", ["four"])], { start: 3 }),
  ]);
});

test("displays raw tags, images and disallowed destinations as text", () => {
  const text = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "<b>raw</b>",
    "[unsafe](javascript:alert(1))",
    "[unsafe](data:text/html,hello)",
    "![image](https://example.com/image.png)",
  ].join("\n");
  expect(renderMarkdown(text)).toMatchObject([element("p", [text])]);
});

test("resolves stored mentions using the actor ID in message metadata", () => {
  expect(
    renderMarkdown(
      "Hello @[ob:user:u_example], @[missing], **ask @[ob:user:u_example]**, _tell @[ob:user:u_example] please_ and `@[ob:user:u_example]`. [Ask @[ob:user:u_example]](https://example.com/help)",
      [
        { written: "@previous", actor: { id: "ob:user:u_example", handle: "ada", name: "Ada" }, candidates: [] },
        { written: "@missing", actor: null, candidates: [{ id: "missing", handle: "grace", name: "Grace" }] },
      ],
    ),
  ).toMatchObject([
    element("p", [
      "Hello @ada, @[missing], ",
      element("strong", ["ask @ada"]),
      ", ",
      element("em", ["tell @ada please"]),
      " and ",
      element("code", "@[ob:user:u_example]"),
      ". ",
      element("a", "Ask @ada", { href: "https://example.com/help" }),
    ]),
  ]);
});

test.each([
  ["## **Deploy** _plan_ for `v2`\r\nSecond line", "Deploy plan for v2"],
  ["> > 1. * - Review **_today_**", "Review today"],
  ["- Keep snake_case and #123", "Keep snake_case and #123"],
  ["Run ``git status`` and **run `echo *`**", "Run git status and run echo *"],
  ["Use ``a ` b`` and **run `echo **`**", "Use a ` b and run echo **"],
  ["* `**literal**` <img src=x onerror=alert(1)>", "**literal** <img src=x onerror=alert(1)>"],
])("converts the first line of %j to a plain thread preview", (text, expected) => {
  expect(markdownPreview(text)).toBe(expected);
});

test("renders six heading levels and keeps HTML inside headings as text", () => {
  const html = "<img src=x onerror=alert(1)>";
  expect(
    renderMarkdown(
      ["Before", `# ${html}`, "## **Two**", "### Three ###", "#### Four", "##### Five", "###### Six", "#literal"].join(
        "\n",
      ),
    ),
  ).toMatchObject([
    element("p", ["Before"]),
    element("h1", [html]),
    element("h2", [element("strong", ["Two"])]),
    element("h3", ["Three"]),
    element("h4", ["Four"]),
    element("h5", ["Five"]),
    element("h6", ["Six"]),
    element("p", ["#literal"]),
  ]);
});
