import type { Dialect } from "@openboard/driver-sql";

export const dialect: Dialect = { name: "postgres", placeholder: (index) => `$${index}`, lockSuffix: " FOR UPDATE" };
