import { describe, expect, test } from "bun:test";
import { decideMemberRole } from "../../src/orgs/roles.ts";

describe("organization role changes", () => {
  test("an administrator can promote and demote ordinary members", () => {
    expect(decideMemberRole("admin", "member", "admin")).toBe(true);
    expect(decideMemberRole("admin", "admin", "member")).toBe(true);
  });

  test("only owners can grant the owner role", () => {
    expect(() => decideMemberRole("admin", "member", "owner")).toThrow("you cannot assign");
    expect(decideMemberRole("owner", "member", "owner")).toBe(true);
  });

  test("only an owner can change an owner's role", () => {
    expect(() => decideMemberRole("admin", "owner", "admin")).toThrow(expect.objectContaining({ code: "forbidden" }));
    expect(decideMemberRole("owner", "owner", "admin")).toBe(true);
  });

  test("a member cannot assign any role", () => {
    expect(() => decideMemberRole("member", "member", "admin")).toThrow("you cannot assign");
  });

  test("keeping the same role needs no write", () => {
    expect(decideMemberRole("owner", "admin", "admin")).toBe(false);
  });
});
