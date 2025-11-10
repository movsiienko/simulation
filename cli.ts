#!/usr/bin/env bun

import { parseArgs } from "util";

interface CliOptions {
  tokens?: number;
  usd?: number;
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

  // Parse and validate numbers
  if (hasTokens) {
    const tokens = parseFloat(values.tokens as string);
    if (isNaN(tokens)) {
      console.error(`Error: Invalid token amount: ${values.tokens}`);
      process.exit(1);
    }
    return { tokens };
  }

  if (hasUsd) {
    const usd = parseFloat(values.usd as string);
    if (isNaN(usd)) {
      console.error(`Error: Invalid USD amount: ${values.usd}`);
      process.exit(1);
    }
    return { usd };
  }

  return {};
}

function main() {
  const options = parseCliArgs();

  if (options.tokens !== undefined) {
    console.log(`Token amount: ${options.tokens}`);
    // Add your logic here
  } else if (options.usd !== undefined) {
    console.log(`USD amount: ${options.usd}`);
    // Add your logic here
  }
}

if (import.meta.main) {
  main();
}

export { parseCliArgs, type CliOptions };

