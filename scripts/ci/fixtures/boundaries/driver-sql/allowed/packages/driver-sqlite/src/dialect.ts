import type { Dialect } from "@openboard/driver-sql";

export const dialect: Dialect = { name: "sqlite", placeholder: () => "?", lockSuffix: "" };
