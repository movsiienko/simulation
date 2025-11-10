import { parseArgs } from "util";

interface DataGroupConfig {
  label: string;
  tokenShare: number;
}

const DATA_GROUPS = {
  county: { label: "County", tokenShare: 0.6 },
  photo: { label: "Photo", tokenShare: 0.15 },
  mortgage: { label: "Mortgage", tokenShare: 0.03 },
  hoa: { label: "HOA", tokenShare: 0.03 },
  proprtyRanking: { label: "PropertyRanking", tokenShare: 0.01 },
  propertyImprovement: { label: "PropertyImprovement", tokenShare: 0.05 },
  envCharateris: { label: "EnvCharateris", tokenShare: 0.01 },
  safetyAndSecurity: { label: "SafetyAndSecurity", tokenShare: 0.01 },
  transportationAndAccess: {
    label: "TransportationAndAccess",
    tokenShare: 0.01,
  },
  school: { label: "School", tokenShare: 0.01 },
} as const satisfies Record<string, DataGroupConfig>;

type DataGroupKey = keyof typeof DATA_GROUPS;

interface CliOptions {
  tokens?: number;
  usd?: number;
  extractedProperties: number;
  dataGroup: DataGroupKey;
  maxWorkersPerWeek?: number;
}

interface DecayParameters {
  totalTokens: number;
  totalProperties: number;
  lambda: number;
  a0: number;
  expNegLambda: number;
  geometricDenominator: number;
}

const TOTAL_TOKENS = 100_000_000;
const TOTAL_PROPERTIES = 150_000_000;
const MIN_TAIL_REWARD = 0.01;

const DECAY_PARAMS = buildDecayParameters();

function parseCliArgs(): CliOptions {
  const { values } = parseArgs({
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
      "data-group": {
        type: "string",
        short: "g",
      },
      "extracted-properties": {
        type: "string",
        short: "e",
      },
      "max-workers": {
        type: "string",
        short: "w",
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
  const dataGroupInput = (
    (values["data-group"] as string | undefined) ?? "county"
  ).toLowerCase();
  const dataGroup = DATA_GROUPS[dataGroupInput];
  if (!dataGroup) {
    console.error(
      `Error: Unsupported data group "${values["data-group"]}". Available data groups are ${Object.values(
        DATA_GROUPS,
      )
        .map((dgroup) => dgroup.label)
        .join(", ")}`,
    );
    process.exit(1);
  }

  let extractedProperties = 0;
  if (values["extracted-properties"] !== undefined) {
    extractedProperties = parseFloat(values["extracted-properties"] as string);
    if (isNaN(extractedProperties) || extractedProperties < 0) {
      console.error(
        `Error: Invalid extracted property count: ${values["extracted-properties"]}`,
      );
      process.exit(1);
    }
    if (!Number.isInteger(extractedProperties)) {
      console.error("Error: Extracted properties must be a whole number.");
      process.exit(1);
    }
  }

  if (extractedProperties > TOTAL_PROPERTIES) {
    console.error(
      `Error: Extracted properties (${extractedProperties}) cannot exceed total available properties (${TOTAL_PROPERTIES}).`,
    );
    process.exit(1);
  }

  let maxWorkersPerWeek: number | undefined;
  if (values["max-workers"] !== undefined) {
    maxWorkersPerWeek = Number(values["max-workers"]);
    if (
      !Number.isFinite(maxWorkersPerWeek) ||
      !Number.isInteger(maxWorkersPerWeek) ||
      maxWorkersPerWeek <= 0
    ) {
      console.error(
        `Error: Invalid max workers value: ${values["max-workers"]}. It must be a positive whole number.`,
      );
      process.exit(1);
    }
  }

  const baseOptions = {
    extractedProperties,
    dataGroup: dataGroupInput as DataGroupKey,
    maxWorkersPerWeek,
  } satisfies CliOptions;

  if (hasTokens) {
    const tokens = parseFloat(values.tokens as string);
    if (isNaN(tokens)) {
      console.error(`Error: Invalid token amount: ${values.tokens}`);
      process.exit(1);
    }
    return {
      ...baseOptions,
      tokens,
    };
  }

  if (hasUsd) {
    const usd = parseFloat(values.usd as string);
    if (isNaN(usd)) {
      console.error(`Error: Invalid USD amount: ${values.usd}`);
      process.exit(1);
    }
    return {
      ...baseOptions,
      usd,
    };
  }

  return baseOptions;
}

interface DistributionContext {
  startIndex: number;
  dataGroup: DataGroupConfig;
}

function buildDistributionContext(options: CliOptions): DistributionContext {
  return {
    startIndex: options.extractedProperties,
    dataGroup: DATA_GROUPS[options.dataGroup],
  };
}

function lastAllocation(lambda: number): number {
  const numerator = 1 - Math.exp(-lambda);
  const denominator = 1 - Math.exp(-lambda * TOTAL_PROPERTIES);
  const a0 = TOTAL_TOKENS * (numerator / denominator);
  return a0 * Math.exp(-lambda * (TOTAL_PROPERTIES - 1));
}

function solveLambdaForTail(
  lo: number = 1e-16,
  hi: number = 1e-5,
  iters: number = 200,
): number {
  for (let i = 0; i < iters; i++) {
    const mid = 0.5 * (lo + hi);
    if (lastAllocation(mid) > MIN_TAIL_REWARD) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return 0.5 * (lo + hi);
}

function a0FromLambda(lambda: number): number {
  const numerator = 1 - Math.exp(-lambda);
  const denominator = 1 - Math.exp(-lambda * TOTAL_PROPERTIES);
  return TOTAL_TOKENS * (numerator / denominator);
}

function buildDecayParameters(): DecayParameters {
  const lambda = solveLambdaForTail();
  const a0 = a0FromLambda(lambda);
  const expNegLambda = Math.exp(-lambda);
  const geometricDenominator = 1 - expNegLambda;
  return {
    totalTokens: TOTAL_TOKENS,
    totalProperties: TOTAL_PROPERTIES,
    lambda,
    a0,
    expNegLambda,
    geometricDenominator,
  };
}

function tokensForRange(
  startIndex: number,
  count: number,
  dataGroup: DataGroupConfig,
): number {
  if (count <= 0 || startIndex >= DECAY_PARAMS.totalProperties) {
    return 0;
  }

  const cappedCount = Math.min(
    count,
    DECAY_PARAMS.totalProperties - startIndex,
  );

  const startFactor = Math.exp(-DECAY_PARAMS.lambda * startIndex);
  const numerator = 1 - Math.exp(-DECAY_PARAMS.lambda * cappedCount);
  const baseTokens =
    DECAY_PARAMS.a0 *
    startFactor *
    (numerator / DECAY_PARAMS.geometricDenominator);

  return dataGroup.tokenShare * baseTokens;
}

function allocationForIndex(index: number, dataGroup: DataGroupConfig): number {
  if (index < 0 || index >= DECAY_PARAMS.totalProperties) {
    return 0;
  }
  const base = DECAY_PARAMS.a0 * Math.exp(-DECAY_PARAMS.lambda * index);
  return dataGroup.tokenShare * base;
}

function availableProperties(startIndex: number): number {
  return Math.max(0, DECAY_PARAMS.totalProperties - startIndex);
}

function propertiesForTokens(
  tokens: number,
  context: DistributionContext,
  tolerance: number = 1e-6,
): number {
  if (tokens <= 0) {
    return 0;
  }

  const maxCount = availableProperties(context.startIndex);
  if (maxCount === 0) {
    return 0;
  }

  const maxTokens = tokensForRange(
    context.startIndex,
    maxCount,
    context.dataGroup,
  );

  if (tokens >= maxTokens) {
    return maxCount;
  }

  let lo = 0;
  let hi = maxCount;

  for (let i = 0; i < 120; i++) {
    const mid = 0.5 * (lo + hi);
    const minted = tokensForRange(context.startIndex, mid, context.dataGroup);

    if (Math.abs(minted - tokens) <= tolerance) {
      return mid;
    }

    if (minted < tokens) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return hi;
}

// Cost constants
const STORAGE_COST_PER_PROPERTY = 1200 / 10000000; // $0.00012
const AWS_COMPUTE_COST_PER_PROPERTY = 0.0003;
const BLOCKCHAIN_GAS_COST_PER_PROPERTY = 0.0013;
const TOTAL_COST_PER_PROPERTY =
  STORAGE_COST_PER_PROPERTY +
  AWS_COMPUTE_COST_PER_PROPERTY +
  BLOCKCHAIN_GAS_COST_PER_PROPERTY;

// Labor constants
const PROPERTIES_PER_COUNTY = 56708.373011800926;
const COST_PER_PERSON_PER_WEEK = 2500;
const WEEKS_PER_COUNTY = 2; // 2 weeks per county (1 week unpaid training + 1 week paid extraction)
const DEFAULT_MAX_WORKERS_PER_WEEK = Number.POSITIVE_INFINITY;

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
  distribution: DistributionDetails;
}

interface DistributionDetails {
  dataGroupLabel: string;
  extractedBefore: number;
  startPropertyRank: number;
  endPropertyRank: number;
  availableProperties: number;
  firstPropertyReward: number;
  lastPropertyReward: number;
  averageTokensPerProperty: number;
}

function calculateLabor(
  properties: number,
  maxWorkersPerWeek?: number,
): {
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

  const onboardingLimit =
    maxWorkersPerWeek ?? DEFAULT_MAX_WORKERS_PER_WEEK;

  // Kick off week 1 by onboarding up to the limit of new people for training.
  const initialStarters = Math.min(onboardingLimit, totalCountiesNeeded);
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

    // Bring in up to the limit of brand new people this week (training capacity limit).
    const newStarters = Math.min(onboardingLimit, remainingToStart);
    if (newStarters > 0) {
      stageCounts[0] += newStarters;
      activeInProgress += newStarters;
      countiesStarted += newStarters;
      remainingToStart -= newStarters;
    }
  }

  return { laborCost, counties, weeks, peoplePerWeek };
}

function calculateFromTokens(
  tokens: number,
  context: DistributionContext,
  maxWorkersPerWeek?: number,
): CalculationResult {
  const properties = propertiesForTokens(tokens, context);
  return buildCalculationResult({
    properties,
    context,
    maxWorkersPerWeek,
  });
}

function calculateFromUsd(
  usd: number,
  context: DistributionContext,
  maxWorkersPerWeek?: number,
): CalculationResult {
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
    const { laborCost } = calculateLabor(properties, maxWorkersPerWeek);
    const nonLaborCost = properties * TOTAL_COST_PER_PROPERTY;
    const totalCost = nonLaborCost + laborCost;
    properties = properties * (usd / totalCost);
    iterations++;
  }

  properties = Math.min(properties, availableProperties(context.startIndex));

  return buildCalculationResult({
    properties,
    context,
    usdOverride: usd,
    maxWorkersPerWeek,
  });
}

interface ResultBuilderOptions {
  properties: number;
  context: DistributionContext;
  usdOverride?: number;
  maxWorkersPerWeek?: number;
}

function buildCalculationResult({
  properties,
  context,
  usdOverride,
  maxWorkersPerWeek,
}: ResultBuilderOptions): CalculationResult {
  const clampedProperties = Math.min(
    properties,
    availableProperties(context.startIndex),
  );

  const storageCost = clampedProperties * STORAGE_COST_PER_PROPERTY;
  const awsComputeCost = clampedProperties * AWS_COMPUTE_COST_PER_PROPERTY;
  const blockchainGasCost =
    clampedProperties * BLOCKCHAIN_GAS_COST_PER_PROPERTY;
  const { laborCost, counties, weeks, peoplePerWeek } = calculateLabor(
    clampedProperties,
    maxWorkersPerWeek,
  );
  const computedTotal =
    storageCost + awsComputeCost + blockchainGasCost + laborCost;
  const usdValue = usdOverride ?? computedTotal;
  const tokens = tokensForRange(
    context.startIndex,
    clampedProperties,
    context.dataGroup,
  );
  const distribution = summarizeDistribution(
    clampedProperties,
    context,
    tokens,
  );

  return {
    properties: clampedProperties,
    tokens,
    usd: usdValue,
    costBreakdown: {
      storage: storageCost,
      awsCompute: awsComputeCost,
      blockchainGas: blockchainGasCost,
      labor: laborCost,
      total: usdValue,
    },
    timeline: {
      counties,
      weeks,
      peoplePerWeek,
    },
    distribution,
  };
}

function summarizeDistribution(
  properties: number,
  context: DistributionContext,
  tokens: number,
): DistributionDetails {
  const maxAvailable = availableProperties(context.startIndex);
  const clampedProperties = Math.min(properties, maxAvailable);
  const startRank =
    clampedProperties > 0 ? context.startIndex + 1 : context.startIndex;
  const endRank =
    clampedProperties > 0
      ? context.startIndex + clampedProperties
      : context.startIndex;
  const firstReward =
    clampedProperties > 0
      ? allocationForIndex(context.startIndex, context.dataGroup)
      : 0;
  const lastReward =
    clampedProperties > 0
      ? allocationForIndex(
          context.startIndex + Math.max(clampedProperties - 1, 0),
          context.dataGroup,
        )
      : 0;
  const average = clampedProperties > 0 ? tokens / clampedProperties : 0;

  return {
    dataGroupLabel: context.dataGroup.label,
    extractedBefore: context.startIndex,
    startPropertyRank: clampedProperties > 0 ? startRank : 0,
    endPropertyRank: clampedProperties > 0 ? endRank : 0,
    availableProperties: maxAvailable,
    firstPropertyReward: firstReward,
    lastPropertyReward: lastReward,
    averageTokensPerProperty: average,
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
  console.log(dim + "  Distribution:" + reset);
  console.log(
    `    Data Group:            ${result.distribution.dataGroupLabel}`,
  );
  console.log(
    `    Extracted Before:      ${formatNumber(result.distribution.extractedBefore, 0)}`,
  );
  console.log(
    `    Start Property Rank:   ${formatNumber(result.distribution.startPropertyRank, 0)}`,
  );
  console.log(
    `    End Property Rank:     ${formatNumber(result.distribution.endPropertyRank, 2)}`,
  );
  console.log(
    `    Available Properties:  ${formatNumber(result.distribution.availableProperties, 0)}`,
  );
  console.log(
    `    First Reward:          ${formatNumber(result.distribution.firstPropertyReward, 6)} tokens`,
  );
  console.log(
    `    Last Reward:           ${formatNumber(result.distribution.lastPropertyReward, 6)} tokens`,
  );
  console.log(
    `    Avg Reward / Property: ${formatNumber(result.distribution.averageTokensPerProperty, 6)} tokens`,
  );
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
  const context = buildDistributionContext(options);

  if (options.tokens !== undefined) {
    const result = calculateFromTokens(
      options.tokens,
      context,
      options.maxWorkersPerWeek,
    );
    printResult(result, true);
  } else if (options.usd !== undefined) {
    const result = calculateFromUsd(
      options.usd,
      context,
      options.maxWorkersPerWeek,
    );
    printResult(result, false);
  }
}

if (import.meta.main) {
  main();
}

export { parseCliArgs, type CliOptions };
