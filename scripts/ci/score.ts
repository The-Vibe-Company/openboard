type Score = {
  local: readonly string[];
  hosted: readonly string[];
};

export function missingHostedChecks({ local, hosted }: Score): string[] {
  const hostedNames = new Set(hosted);
  return local.filter((name) => !hostedNames.has(name));
}

if (import.meta.main) {
  const path = Bun.argv[2] ?? "tools/conformance/score.json";
  try {
    const missing = missingHostedChecks(await Bun.file(path).json());
    if (missing.length > 0) {
      console.error(`${path}: hosted is missing checks recorded in local:`);
      for (const name of missing) console.error(`  ${name}`);
      process.exitCode = 1;
    } else {
      console.log(`${path}: hosted includes every local check.`);
    }
  } catch (error) {
    console.error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
