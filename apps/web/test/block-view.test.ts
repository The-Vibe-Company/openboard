import { expect, test } from "bun:test";
import { BlockFields } from "../src/components/BlockView.tsx";

function element(type: string, children: unknown, props = {}) {
  return { type, props: { ...props, children } };
}

function row(name: string, value: unknown) {
  return element("div", [element("dt", name), element("dd", value)]);
}

test("renders nested fields, lists, safe URI links and unknown fields in order", () => {
  const details = {
    title: "Details",
    properties: { links: { items: { format: "uri" } } },
  };
  const data = {
    extra: "<script>text</script>",
    count: 0,
    details: { links: ["https://example.com/", "http://example.com/", "javascript:alert(1)"] },
  };
  expect(
    BlockFields({
      data,
      schema: { properties: { details, count: {} }, additionalProperties: { title: "Extra field" } },
    }),
  ).toMatchObject(
    element("dl", [
      row("Details", { type: BlockFields, props: { data: data.details, schema: details } }),
      row("count", "0"),
      row("extra", "<script>text</script>"),
    ]),
  );
  expect(BlockFields({ data: data.details, schema: details })).toMatchObject(
    element("dl", [
      row(
        "links",
        element("ul", [
          element(
            "li",
            element("a", "https://example.com/", {
              href: "https://example.com/",
              target: "_blank",
              rel: "noopener noreferrer",
            }),
          ),
          element(
            "li",
            element("a", "http://example.com/", {
              href: "http://example.com/",
              target: "_blank",
              rel: "noopener noreferrer",
            }),
          ),
          element("li", "javascript:alert(1)"),
        ]),
      ),
    ]),
  );
});
