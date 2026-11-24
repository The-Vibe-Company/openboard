#!/usr/bin/env node
import process from "node:process";
import { clientEnvironment, runCli } from "../dist/main.js";

const args = process.argv.slice(2);
if (args[0] === "serve") {
  process.stderr.write(
    "error: invalid_request: ob serve needs the openboard binary\n" +
      "next: install the openboard executable or run the OpenBoard container image\n",
  );
  process.exitCode = 2;
} else {
  process.exitCode = await runCli(args, clientEnvironment());
}
