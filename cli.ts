#!/usr/bin/env bun

import { parseArgs } from "util";

interface CliOptions {
  tokens?: string;
  usd?: string;
}

function parseCliArgs(): CliOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2), // Skip 'bun' and script path
    options: {
      tokens: {
        type: "string",
        short: "t",
      },
      usd: {
        type: "string",
        short: "u",
      },
    },
    strict: true,
    allowPositionals: true,
  });

  // Check that only one of tokens or usd is provided
  const hasTokens = !!values.tokens;
  const hasUsd = !!values.usd;

  if (!hasTokens && !hasUsd) {
    console.error("Error: Either --tokens (-t) or --usd (-u) must be provided");
    process.exit(1);
  }

  if (hasTokens && hasUsd) {
    console.error("Error: Only one of --tokens (-t) or --usd (-u) can be provided");
    process.exit(1);
  }

  return {
    tokens: values.tokens as string | undefined,
    usd: values.usd as string | undefined,
  };
}

function main() {
  const options = parseCliArgs();

  if (options.tokens) {
    const tokens = parseFloat(options.tokens);
    if (isNaN(tokens)) {
      console.error(`Error: Invalid token amount: ${options.tokens}`);
      process.exit(1);
    }
    console.log(`Token amount: ${tokens}`);
    // Add your logic here
  } else if (options.usd) {
    const usd = parseFloat(options.usd);
    if (isNaN(usd)) {
      console.error(`Error: Invalid USD amount: ${options.usd}`);
      process.exit(1);
    }
    console.log(`USD amount: ${usd}`);
    // Add your logic here
  }
}

if (import.meta.main) {
  main();
}

export { parseCliArgs, type CliOptions };

