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
    console.error(
      "Error: Only one of --tokens (-t) or --usd (-u) can be provided",
    );
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
const TOTAL_COST_PER_PROPERTY =
  STORAGE_COST_PER_PROPERTY +
  AWS_COMPUTE_COST_PER_PROPERTY +
  BLOCKCHAIN_GAS_COST_PER_PROPERTY;
const COST_PER_TOKEN = TOTAL_COST_PER_PROPERTY / TOKENS_PER_PROPERTY;

// Labor constants
const PROPERTIES_PER_COUNTY = 56708.373011800926;
const COST_PER_PERSON_PER_WEEK = 2500;
const WEEKS_PER_COUNTY = 2; // 2 weeks per county (1 week unpaid training + 1 week paid extraction)
const MAX_PEOPLE_PER_WEEK = 5; // Only 5 people can start per week

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

function calculateLabor(properties: number): {
  laborCost: number;
  counties: number;
  weeks: number;
  peoplePerWeek: number[];
} {
  const counties = properties / PROPERTIES_PER_COUNTY;
  const totalCountiesNeeded = Math.ceil(counties - 1e-9);

  if (totalCountiesNeeded <= 0) {
    return { laborCost: 0, counties, weeks: 0, peoplePerWeek: [] };
  }

  const stageCounts = Array.from({ length: WEEKS_PER_COUNTY }, () => 0);
  const peoplePerWeek: number[] = [];
  let laborCost = 0;
  let weeks = 0;
  let countiesCompleted = 0;
  let countiesStarted = 0;

  // Kick off week 1 by onboarding up to 5 new people for training.
  const initialStarters = Math.min(MAX_PEOPLE_PER_WEEK, totalCountiesNeeded);
  stageCounts[0] = initialStarters;
  countiesStarted = initialStarters;

  while (
    countiesCompleted < totalCountiesNeeded ||
    stageCounts.some((count) => count > 0)
  ) {
    const activeWorkers = stageCounts.reduce((sum, count) => sum + count, 0);
    if (activeWorkers === 0) {
      break;
    }

    weeks++;
    peoplePerWeek.push(activeWorkers);

    const extractingThisWeek = stageCounts[WEEKS_PER_COUNTY - 1];
    laborCost += extractingThisWeek * COST_PER_PERSON_PER_WEEK;

    const finishingThisWeek = extractingThisWeek;
    countiesCompleted = Math.min(
      totalCountiesNeeded,
      countiesCompleted + finishingThisWeek,
    );

    // Move everyone to the next phase of their 2-week cycle.
    for (let stage = WEEKS_PER_COUNTY - 1; stage > 0; stage--) {
      stageCounts[stage] = stageCounts[stage - 1];
    }
    stageCounts[0] = 0;

    let activeInProgress = stageCounts.reduce((sum, count) => sum + count, 0);
    countiesStarted = countiesCompleted + activeInProgress;
    let remainingToStart = Math.max(0, totalCountiesNeeded - countiesStarted);

    // People who just finished can immediately start training on a new county
    // if there is still work left. Returning workers do not count against the
    // weekly onboarding limit.
    const returningWorkers = Math.min(finishingThisWeek, remainingToStart);
    if (returningWorkers > 0) {
      stageCounts[0] += returningWorkers;
      activeInProgress += returningWorkers;
      countiesStarted += returningWorkers;
      remainingToStart -= returningWorkers;
    }

    // Bring in up to 5 brand new people this week (training capacity limit).
    const newStarters = Math.min(MAX_PEOPLE_PER_WEEK, remainingToStart);
    if (newStarters > 0) {
      stageCounts[0] += newStarters;
      activeInProgress += newStarters;
      countiesStarted += newStarters;
      remainingToStart -= newStarters;
    }
  }

  return { laborCost, counties, weeks, peoplePerWeek };
}

function calculateFromTokens(tokens: number): CalculationResult {
  const properties = tokens / TOKENS_PER_PROPERTY;
  const storageCost = properties * STORAGE_COST_PER_PROPERTY;
  const awsComputeCost = properties * AWS_COMPUTE_COST_PER_PROPERTY;
  const blockchainGasCost = properties * BLOCKCHAIN_GAS_COST_PER_PROPERTY;
  const { laborCost, counties, weeks, peoplePerWeek } =
    calculateLabor(properties);
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
  let properties =
    usd /
    (TOTAL_COST_PER_PROPERTY +
      COST_PER_PERSON_PER_WEEK / PROPERTIES_PER_COUNTY);
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
  const { laborCost, counties, weeks, peoplePerWeek } =
    calculateLabor(properties);

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

  console.log(
    "\n" + dim + "═══════════════════════════════════════════════════" + reset,
  );

  if (isFromTokens) {
    console.log(
      `  Tokens Input: ${highlight}${formatNumber(result.tokens, 2)} tokens${reset}`,
    );
    console.log(
      `  USD Required: ${highlight}${formatCurrency(result.usd)}${reset}`,
    );
  } else {
    console.log(
      `  USD Input: ${highlight}${formatCurrency(result.usd)}${reset}`,
    );
    console.log(
      `  Tokens Earned: ${highlight}${formatNumber(result.tokens, 2)} tokens${reset}`,
    );
  }

  console.log(
    dim + "═══════════════════════════════════════════════════" + reset,
  );
  console.log(`  Properties: ${formatNumber(result.properties, 2)}`);
  console.log(
    dim + "═══════════════════════════════════════════════════" + reset,
  );
  console.log(dim + "  Cost Breakdown:" + reset);
  console.log(
    `    Storage:        ${formatCurrency(result.costBreakdown.storage)}`,
  );
  console.log(
    `    AWS Compute:    ${formatCurrency(result.costBreakdown.awsCompute)}`,
  );
  console.log(
    `    Blockchain Gas: ${formatCurrency(result.costBreakdown.blockchainGas)}`,
  );
  console.log(
    `    Labor:          ${formatCurrency(result.costBreakdown.labor)}`,
  );
  console.log(
    dim + "  ───────────────────────────────────────────────────" + reset,
  );
  console.log(
    `    Total:          ${highlight}${formatCurrency(result.costBreakdown.total)}${reset}`,
  );
  console.log(
    dim + "═══════════════════════════════════════════════════" + reset,
  );
  console.log(dim + "  Timeline:" + reset);
  console.log(
    `    Counties:       ${formatNumber(result.timeline.counties, 2)}`,
  );
  console.log(
    `    Weeks:          ${highlight}${result.timeline.weeks}${reset}`,
  );
  if (result.timeline.peoplePerWeek.length > 0) {
    // Show all weeks
    const weekDetails = result.timeline.peoplePerWeek
      .map(
        (people, idx) =>
          `Week ${idx + 1}: ${Math.round(people)} ${Math.round(people) === 1 ? "person" : "people"}`,
      )
      .join("\n    ");
    console.log(`    Schedule:\n    ${weekDetails}`);
  }
  console.log(
    dim + "═══════════════════════════════════════════════════" + reset + "\n",
  );
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
