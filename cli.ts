#!/usr/bin/env bun

import { parseArgs } from "util";

interface DataGroupConfig {
  label: string;
}

const DATA_GROUPS = {
  county: { label: "County" },
  photo: { label: "Photo" },
  mortgage: { label: "Mortgage" },
  hoa: { label: "HOA" },
  proprtyRanking: { label: "PropertyRanking" },
  propertyImprovement: { label: "PropertyImprovement" },
  envCharateris: { label: "EnvCharateris" },
  safetyAndSecurity: { label: "SafetyAndSecurity" },
  transportationAndAccess: {
    label: "TransportationAndAccess",
  },
  school: { label: "School" },
} as const satisfies Record<string, DataGroupConfig>;

type DataGroupKey = keyof typeof DATA_GROUPS;

interface CliOptions {
  properties: number;
  extractedProperties: number;
  dataGroup: DataGroupKey;
  maxTotalWorkers?: number;
}

const TOTAL_PROPERTIES = 150_000_000;

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
const MAX_NEW_PEOPLE_PER_WEEK = 5;
const DEFAULT_MAX_TOTAL_WORKERS = Number.POSITIVE_INFINITY;

function parseCliArgs(): CliOptions {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      properties: {
        type: "string",
        short: "p",
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

  if (values.properties === undefined) {
    console.error(
      "Error: --properties (-p) is required to specify the number of properties to extract.",
    );
    process.exit(1);
  }

  const properties = parseFloat(values.properties as string);
  if (!Number.isFinite(properties) || properties <= 0) {
    console.error(
      `Error: Invalid properties count: ${values.properties}. It must be a positive whole number.`,
    );
    process.exit(1);
  }
  if (!Number.isInteger(properties)) {
    console.error("Error: Properties count must be a whole number.");
    process.exit(1);
  }

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

  const remainingCapacity = availableProperties(extractedProperties);
  if (properties > remainingCapacity) {
    console.error(
      `Error: Requested properties (${properties}) exceed remaining available properties (${remainingCapacity}).`,
    );
    process.exit(1);
  }

  let maxTotalWorkers: number | undefined;
  if (values["max-workers"] !== undefined) {
    maxTotalWorkers = Number(values["max-workers"]);
    if (
      !Number.isFinite(maxTotalWorkers) ||
      !Number.isInteger(maxTotalWorkers) ||
      maxTotalWorkers <= 0
    ) {
      console.error(
        `Error: Invalid max workers value: ${values["max-workers"]}. It must be a positive whole number.`,
      );
      process.exit(1);
    }
  }

  return {
    properties,
    extractedProperties,
    dataGroup: dataGroupInput as DataGroupKey,
    maxTotalWorkers,
  } satisfies CliOptions;
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

function availableProperties(startIndex: number): number {
  return Math.max(0, TOTAL_PROPERTIES - startIndex);
}

interface CalculationResult {
  properties: number;
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
  remainingAfterPlan: number;
}

function calculateLabor(
  properties: number,
  maxTotalWorkers?: number,
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

  const totalWorkerLimit = maxTotalWorkers ?? DEFAULT_MAX_TOTAL_WORKERS;
  let totalNewPeople = 0;

  const initialStarters = Math.min(
    MAX_NEW_PEOPLE_PER_WEEK,
    totalCountiesNeeded,
    totalWorkerLimit,
  );
  stageCounts[0] = initialStarters;
  countiesStarted = initialStarters;
  totalNewPeople = initialStarters;

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

    for (let stage = WEEKS_PER_COUNTY - 1; stage > 0; stage--) {
      stageCounts[stage] = stageCounts[stage - 1];
    }
    stageCounts[0] = 0;

    let activeInProgress = stageCounts.reduce((sum, count) => sum + count, 0);
    countiesStarted = countiesCompleted + activeInProgress;
    let remainingToStart = Math.max(0, totalCountiesNeeded - countiesStarted);

    const returningWorkers = Math.min(finishingThisWeek, remainingToStart);
    if (returningWorkers > 0) {
      stageCounts[0] += returningWorkers;
      activeInProgress += returningWorkers;
      countiesStarted += returningWorkers;
      remainingToStart -= returningWorkers;
    }

    const remainingNewPeopleCapacity = Math.max(
      0,
      totalWorkerLimit - totalNewPeople,
    );
    const newStarters = Math.min(
      MAX_NEW_PEOPLE_PER_WEEK,
      remainingNewPeopleCapacity,
      remainingToStart,
    );
    if (newStarters > 0) {
      stageCounts[0] += newStarters;
      activeInProgress += newStarters;
      countiesStarted += newStarters;
      remainingToStart -= newStarters;
      totalNewPeople += newStarters;
    }
  }

  return { laborCost, counties, weeks, peoplePerWeek };
}

interface ResultBuilderOptions {
  properties: number;
  context: DistributionContext;
  maxTotalWorkers?: number;
}

function buildCalculationResult({
  properties,
  context,
  maxTotalWorkers,
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
    maxTotalWorkers,
  );
  const totalCost =
    storageCost + awsComputeCost + blockchainGasCost + laborCost;

  const distribution = summarizeDistribution(clampedProperties, context);

  return {
    properties: clampedProperties,
    costBreakdown: {
      storage: storageCost,
      awsCompute: awsComputeCost,
      blockchainGas: blockchainGasCost,
      labor: laborCost,
      total: totalCost,
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
): DistributionDetails {
  const availableBeforePlan = availableProperties(context.startIndex);
  const clampedProperties = Math.min(properties, availableBeforePlan);
  const startRank =
    clampedProperties > 0 ? context.startIndex + 1 : context.startIndex;
  const endRank =
    clampedProperties > 0
      ? context.startIndex + clampedProperties
      : context.startIndex;

  return {
    dataGroupLabel: context.dataGroup.label,
    extractedBefore: context.startIndex,
    startPropertyRank: clampedProperties > 0 ? startRank : 0,
    endPropertyRank: clampedProperties > 0 ? endRank : 0,
    availableProperties: availableBeforePlan,
    remainingAfterPlan: Math.max(0, availableBeforePlan - clampedProperties),
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

function printResult(result: CalculationResult) {
  console.log(
    "\n═══════════════════════════════════════════════════",
  );
  console.log(
    `  Requested Properties: ${formatNumber(result.properties, 2)}`,
  );
  console.log(
    "═══════════════════════════════════════════════════",
  );
  console.log("  Distribution:");
  console.log(
    `    Data Group:             ${result.distribution.dataGroupLabel}`,
  );
  console.log(
    `    Extracted Before:       ${formatNumber(result.distribution.extractedBefore, 0)}`,
  );
  console.log(
    `    Start Property Rank:    ${formatNumber(result.distribution.startPropertyRank, 0)}`,
  );
  console.log(
    `    End Property Rank:      ${formatNumber(result.distribution.endPropertyRank, 0)}`,
  );
  console.log(
    `    Available Before Plan:  ${formatNumber(result.distribution.availableProperties, 0)}`,
  );
  console.log(
    `    Remaining After Plan:   ${formatNumber(result.distribution.remainingAfterPlan, 0)}`,
  );
  console.log(
    "═══════════════════════════════════════════════════",
  );
  console.log("  Cost Breakdown:");
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
    "  ───────────────────────────────────────────────────",
  );
  console.log(
    `    Total:          ${formatCurrency(result.costBreakdown.total)}`,
  );
  console.log(
    "═══════════════════════════════════════════════════",
  );
  console.log("  Timeline:");
  console.log(
    `    Counties:       ${formatNumber(result.timeline.counties, 2)}`,
  );
  console.log(
    `    Weeks:          ${result.timeline.weeks}`,
  );
  if (result.timeline.peoplePerWeek.length > 0) {
    const weekDetails = result.timeline.peoplePerWeek
      .map(
        (people, idx) =>
          `Week ${idx + 1}: ${Math.round(people)} ${Math.round(people) === 1 ? "person" : "people"}`,
      )
      .join("\n    ");
    console.log(`    Schedule:\n    ${weekDetails}`);
  }
  console.log(
    "═══════════════════════════════════════════════════\n",
  );
}

function main() {
  const options = parseCliArgs();
  const context = buildDistributionContext(options);
  const result = buildCalculationResult({
    properties: options.properties,
    context,
    maxTotalWorkers: options.maxTotalWorkers,
  });
  printResult(result);
}

if (import.meta.main) {
  main();
}

export { parseCliArgs, type CliOptions };
