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

// Constants
const TOKENS_PER_PROPERTY = 0.6;
const STORAGE_COST_PER_PROPERTY = 1200 / 10000000; // $0.00012
const AWS_COMPUTE_COST_PER_PROPERTY = 0.0003;
const BLOCKCHAIN_GAS_COST_PER_PROPERTY = 0.0013;
const TOTAL_COST_PER_PROPERTY = STORAGE_COST_PER_PROPERTY + AWS_COMPUTE_COST_PER_PROPERTY + BLOCKCHAIN_GAS_COST_PER_PROPERTY;
const COST_PER_TOKEN = TOTAL_COST_PER_PROPERTY / TOKENS_PER_PROPERTY;

interface CalculationResult {
  properties: number;
  tokens: number;
  usd: number;
  costBreakdown: {
    storage: number;
    awsCompute: number;
    blockchainGas: number;
    total: number;
  };
}

function calculateFromTokens(tokens: number): CalculationResult {
  const properties = tokens / TOKENS_PER_PROPERTY;
  const storageCost = properties * STORAGE_COST_PER_PROPERTY;
  const awsComputeCost = properties * AWS_COMPUTE_COST_PER_PROPERTY;
  const blockchainGasCost = properties * BLOCKCHAIN_GAS_COST_PER_PROPERTY;
  const totalUsd = storageCost + awsComputeCost + blockchainGasCost;

  return {
    properties,
    tokens,
    usd: totalUsd,
    costBreakdown: {
      storage: storageCost,
      awsCompute: awsComputeCost,
      blockchainGas: blockchainGasCost,
      total: totalUsd,
    },
  };
}

function calculateFromUsd(usd: number): CalculationResult {
  const properties = usd / TOTAL_COST_PER_PROPERTY;
  const tokens = properties * TOKENS_PER_PROPERTY;
  const storageCost = properties * STORAGE_COST_PER_PROPERTY;
  const awsComputeCost = properties * AWS_COMPUTE_COST_PER_PROPERTY;
  const blockchainGasCost = properties * BLOCKCHAIN_GAS_COST_PER_PROPERTY;

  return {
    properties,
    tokens,
    usd,
    costBreakdown: {
      storage: storageCost,
      awsCompute: awsComputeCost,
      blockchainGas: blockchainGasCost,
      total: usd,
    },
  };
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 6,
    maximumFractionDigits: 6,
  }).format(value);
}

function formatNumber(value: number, decimals: number = 2): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function printResult(result: CalculationResult, isFromTokens: boolean) {
  const reset = "\u001b[0m";
  // Minimal color scheme: subtle gray for structure, one accent for key values
  const dim = Bun.color("#6b7280", "ansi") || ""; // Subtle gray for borders and labels
  const highlight = Bun.color("#2563eb", "ansi") || ""; // Single accent color for important values

  console.log("\n" + dim + "═══════════════════════════════════════════════════" + reset);

  if (isFromTokens) {
    console.log(`  Tokens Input: ${highlight}${formatNumber(result.tokens, 2)} tokens${reset}`);
    console.log(`  USD Required: ${highlight}${formatCurrency(result.usd)}${reset}`);
  } else {
    console.log(`  USD Input: ${highlight}${formatCurrency(result.usd)}${reset}`);
    console.log(`  Tokens Earned: ${highlight}${formatNumber(result.tokens, 2)} tokens${reset}`);
  }

  console.log(dim + "═══════════════════════════════════════════════════" + reset);
  console.log(`  Properties: ${formatNumber(result.properties, 2)}`);
  console.log(dim + "═══════════════════════════════════════════════════" + reset);
  console.log(dim + "  Cost Breakdown:" + reset);
  console.log(`    Storage:        ${formatCurrency(result.costBreakdown.storage)}`);
  console.log(`    AWS Compute:    ${formatCurrency(result.costBreakdown.awsCompute)}`);
  console.log(`    Blockchain Gas: ${formatCurrency(result.costBreakdown.blockchainGas)}`);
  console.log(dim + "  ───────────────────────────────────────────────────" + reset);
  console.log(`    Total:          ${highlight}${formatCurrency(result.costBreakdown.total)}${reset}`);
  console.log(dim + "═══════════════════════════════════════════════════" + reset + "\n");
}

function main() {
  const options = parseCliArgs();

  if (options.tokens !== undefined) {
    const result = calculateFromTokens(options.tokens);
    printResult(result, true);
  } else if (options.usd !== undefined) {
    const result = calculateFromUsd(options.usd);
    printResult(result, false);
  }
}

if (import.meta.main) {
  main();
}

export { parseCliArgs, type CliOptions };

