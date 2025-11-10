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

// Labor constants
const PROPERTIES_PER_COUNTY = 56708.373011800926;
const COST_PER_PERSON_PER_WEEK = 2500;
const MAX_PEOPLE_PER_WEEK = 5;
const TRAINING_WEEKS = 5; // Each person needs 5 weeks of training
const MAX_TRAINING_STARTS_PER_WEEK = 5; // Only 5 people can start training per week

interface CalculationResult {
  properties: number;
  tokens: number;
  usd: number;
  costBreakdown: {
    storage: number;
    awsCompute: number;
    blockchainGas: number;
    labor: number;
    total: number;
  };
  timeline: {
    counties: number;
    weeks: number;
    peoplePerWeek: number[];
  };
}

function calculateLabor(properties: number): { laborCost: number; counties: number; weeks: number; peoplePerWeek: number[] } {
  const counties = properties / PROPERTIES_PER_COUNTY;

  let remainingCounties = counties;
  let weeks = 0;
  const peoplePerWeek: number[] = [];
  let laborCost = 0;

  // Track when people started training (week number when they started)
  // Each entry represents one person starting training that week
  const trainingStarts: number[] = [];
  // Track available workers (people who have completed training)
  let availableWorkers = 0;

  // Continue until all counties are processed
  while (remainingCounties > 0) {
    weeks++;

    // Check who finishes training this week (started TRAINING_WEEKS ago)
    const finishedThisWeek = trainingStarts.filter(startWeek => startWeek === weeks - TRAINING_WEEKS).length;
    availableWorkers += finishedThisWeek;

    // Count people still in training (started within the last TRAINING_WEEKS weeks)
    const peopleInTraining = trainingStarts.filter(startWeek => startWeek > weeks - TRAINING_WEEKS).length;

    // Start training new people (up to MAX_TRAINING_STARTS_PER_WEEK per week)
    // Continue training until we have enough people to finish all remaining work
    // We need at least as many people (in training + working) as counties remaining
    const totalPeopleInPipeline = peopleInTraining + availableWorkers;
    const peopleNeeded = Math.ceil(remainingCounties);

    // Start training up to 5 people per week if we need more workers
    if (totalPeopleInPipeline < peopleNeeded) {
      const peopleToStartTraining = Math.min(
        MAX_TRAINING_STARTS_PER_WEEK,
        peopleNeeded - totalPeopleInPipeline
      );
      for (let i = 0; i < peopleToStartTraining; i++) {
        trainingStarts.push(weeks);
      }
    }

    // Each available worker can do 1 county per week
    const countiesDoneThisWeek = Math.min(availableWorkers, remainingCounties);
    remainingCounties -= countiesDoneThisWeek;

    // Track how many people are working this week (for display)
    peoplePerWeek.push(availableWorkers);

    // Cost is based on available workers (people who are working, not training)
    // Training is free, so we only pay for workers
    laborCost += availableWorkers * COST_PER_PERSON_PER_WEEK;
  }

  return { laborCost, counties, weeks, peoplePerWeek };
}

function calculateFromTokens(tokens: number): CalculationResult {
  const properties = tokens / TOKENS_PER_PROPERTY;
  const storageCost = properties * STORAGE_COST_PER_PROPERTY;
  const awsComputeCost = properties * AWS_COMPUTE_COST_PER_PROPERTY;
  const blockchainGasCost = properties * BLOCKCHAIN_GAS_COST_PER_PROPERTY;
  const { laborCost, counties, weeks, peoplePerWeek } = calculateLabor(properties);
  const totalUsd = storageCost + awsComputeCost + blockchainGasCost + laborCost;

  return {
    properties,
    tokens,
    usd: totalUsd,
    costBreakdown: {
      storage: storageCost,
      awsCompute: awsComputeCost,
      blockchainGas: blockchainGasCost,
      labor: laborCost,
      total: totalUsd,
    },
    timeline: {
      counties,
      weeks,
      peoplePerWeek,
    },
  };
}

function calculateFromUsd(usd: number): CalculationResult {
  // We need to solve: properties * TOTAL_COST_PER_PROPERTY + laborCost = usd
  // But laborCost depends on properties, so we need to iterate or approximate
  // For simplicity, let's use an iterative approach
  let properties = usd / (TOTAL_COST_PER_PROPERTY + (COST_PER_PERSON_PER_WEEK / PROPERTIES_PER_COUNTY));
  let prevProperties = 0;
  let iterations = 0;

  // Iterate to find the correct properties value
  while (Math.abs(properties - prevProperties) > 0.01 && iterations < 100) {
    prevProperties = properties;
    const { laborCost } = calculateLabor(properties);
    const nonLaborCost = properties * TOTAL_COST_PER_PROPERTY;
    const totalCost = nonLaborCost + laborCost;
    properties = properties * (usd / totalCost);
    iterations++;
  }

  const tokens = properties * TOKENS_PER_PROPERTY;
  const storageCost = properties * STORAGE_COST_PER_PROPERTY;
  const awsComputeCost = properties * AWS_COMPUTE_COST_PER_PROPERTY;
  const blockchainGasCost = properties * BLOCKCHAIN_GAS_COST_PER_PROPERTY;
  const { laborCost, counties, weeks, peoplePerWeek } = calculateLabor(properties);

  return {
    properties,
    tokens,
    usd,
    costBreakdown: {
      storage: storageCost,
      awsCompute: awsComputeCost,
      blockchainGas: blockchainGasCost,
      labor: laborCost,
      total: usd,
    },
    timeline: {
      counties,
      weeks,
      peoplePerWeek,
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
  console.log(`    Labor:          ${formatCurrency(result.costBreakdown.labor)}`);
  console.log(dim + "  ───────────────────────────────────────────────────" + reset);
  console.log(`    Total:          ${highlight}${formatCurrency(result.costBreakdown.total)}${reset}`);
  console.log(dim + "═══════════════════════════════════════════════════" + reset);
  console.log(dim + "  Timeline:" + reset);
  console.log(`    Counties:       ${formatNumber(result.timeline.counties, 2)}`);
  console.log(`    Weeks:          ${highlight}${result.timeline.weeks}${reset}`);
  if (result.timeline.peoplePerWeek.length > 0) {
    const weeks = result.timeline.peoplePerWeek.length;
    if (weeks <= 8) {
      // Show all weeks if 8 or fewer
      const weekDetails = result.timeline.peoplePerWeek.map((people, idx) =>
        `Week ${idx + 1}: ${Math.round(people)} ${Math.round(people) === 1 ? 'person' : 'people'}`
      ).join('\n    ');
      console.log(`    Schedule:\n    ${weekDetails}`);
    } else {
      // Show first 3 weeks, pattern, and last 3 weeks
      const firstWeeks = result.timeline.peoplePerWeek.slice(0, 3).map((people, idx) =>
        `Week ${idx + 1}: ${Math.round(people)} ${Math.round(people) === 1 ? 'person' : 'people'}`
      ).join('\n    ');
      const lastWeeks = result.timeline.peoplePerWeek.slice(-3).map((people, idx) =>
        `Week ${weeks - 3 + idx + 1}: ${Math.round(people)} ${Math.round(people) === 1 ? 'person' : 'people'}`
      ).join('\n    ');
      console.log(`    Schedule:\n    ${firstWeeks}`);
      console.log(`    ... (${weeks - 6} more weeks, increasing by ${MAX_PEOPLE_PER_WEEK} people each week) ...`);
      console.log(`    ${lastWeeks}`);
    }
  }
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

