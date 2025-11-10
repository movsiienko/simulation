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
const COST_PER_PERSON_PER_WEEK = 2500;
const MAX_NEW_PEOPLE_PER_WEEK = 5;
const DEFAULT_MAX_TOTAL_WORKERS = Number.POSITIVE_INFINITY;
const HEARTBEAT_PROPERTIES_PER_PERSON_PER_WEEK = 5_000_000;
const HEARTBEAT_LABOR_COST_PER_PERSON_PER_WEEK = COST_PER_PERSON_PER_WEEK;
const HEARTBEAT_COMPUTE_COST_PER_PROPERTY = AWS_COMPUTE_COST_PER_PROPERTY;
const HEARTBEAT_BLOCKCHAIN_COST_PER_PROPERTY = BLOCKCHAIN_GAS_COST_PER_PROPERTY;
const TICKS_PER_WEEK = 6; // 1 tick = ~1.17 days; supports half-week granularity

interface AvailabilityTierConfig {
  key: "high" | "medium" | "low";
  label: string;
  totalProperties: number;
  totalCounties: number;
  propertiesPerCounty: number;
  trainingWeeksPerCounty: number;
  productionWeeksPerCounty: number;
}

function createTier(config: {
  key: AvailabilityTierConfig["key"];
  label: string;
  totalProperties: number;
  totalCounties: number;
  trainingWeeksPerCounty: number;
  productionWeeksPerCounty: number;
}): AvailabilityTierConfig {
  return {
    ...config,
    propertiesPerCounty: config.totalProperties / config.totalCounties,
  } satisfies AvailabilityTierConfig;
}

const AVAILABILITY_TIERS = [
  createTier({
    key: "high",
    label: "High",
    totalProperties: 110_524_619,
    totalCounties: 1_949,
    trainingWeeksPerCounty: 1,
    productionWeeksPerCounty: 0.5,
  }),
  createTier({
    key: "medium",
    label: "Medium",
    totalProperties: 20_188_349,
    totalCounties: 635,
    trainingWeeksPerCounty: 5 / 3, // train 3/5 of a county per week
    productionWeeksPerCounty: 2 / 3, // produce 1.5 trained counties per week
  }),
  createTier({
    key: "low",
    label: "Low",
    totalProperties: 15_305_922,
    totalCounties: 504,
    trainingWeeksPerCounty: 5,
    productionWeeksPerCounty: 1,
  }),
] as const;

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

interface HeartbeatSummary {
  properties: number;
  peopleNeeded: number;
  weeklyLaborCost: number;
  weeklyComputeCost: number;
  weeklyBlockchainCost: number;
  weeklyTotalCost: number;
}

interface CalculationResult {
  properties: number;
  costBreakdown: {
    storage: number;
    awsCompute: number;
    blockchainGas: number;
    labor: number;
    heartbeatLabor: number;
    heartbeatCompute: number;
    heartbeatBlockchain: number;
    total: number;
  };
  timeline: {
    counties: number;
    weeks: number;
    peoplePerWeek: number[];
    heartbeatPeoplePerWeek: number[];
  };
  distribution: DistributionDetails;
  heartbeat: HeartbeatSummary;
}

interface DistributionDetails {
  dataGroupLabel: string;
  extractedBefore: number;
  startPropertyRank: number;
  endPropertyRank: number;
  availableProperties: number;
  remainingAfterPlan: number;
}

interface TierWorkload {
  tier: AvailabilityTierConfig;
  properties: number;
  countiesFloat: number;
  countiesNeeded: number;
}

interface TierState {
  workload: TierWorkload;
  trainingTicks: number;
  productionTicks: number;
  stageLength: number;
  countiesCompletedInt: number;
  propertiesCompleted: number;
}

interface WorkerContext {
  idleWorkers: number;
  newPeopleThisWeek: number;
  totalNewPeople: number;
  totalWorkerLimit: number;
}

function buildTierWorkloads(
  properties: number,
  extractedProperties: number,
): TierWorkload[] {
  let remainingPlan = properties;
  let remainingExtracted = extractedProperties;
  const workloads: TierWorkload[] = [];

  for (const tier of AVAILABILITY_TIERS) {
    const alreadyExtractedHere = Math.min(remainingExtracted, tier.totalProperties);
    remainingExtracted -= alreadyExtractedHere;

    const tierRemainingProperties = tier.totalProperties - alreadyExtractedHere;
    if (tierRemainingProperties <= 0) {
      continue;
    }

    if (remainingPlan <= 0) {
      break;
    }

    const tierPropertiesToPlan = Math.min(remainingPlan, tierRemainingProperties);
    if (tierPropertiesToPlan <= 0) {
      continue;
    }

    const countiesFloat = tierPropertiesToPlan / tier.propertiesPerCounty;
    const countiesNeeded = Math.ceil(countiesFloat - 1e-9);

    workloads.push({
      tier,
      properties: tierPropertiesToPlan,
      countiesFloat,
      countiesNeeded,
    });

    remainingPlan -= tierPropertiesToPlan;
  }

  return workloads;
}

function initializeTierState(workload: TierWorkload): TierState {
  const trainingTicks = Math.max(
    1,
    Math.round(workload.tier.trainingWeeksPerCounty * TICKS_PER_WEEK),
  );
  const productionTicks = Math.max(
    1,
    Math.round(workload.tier.productionWeeksPerCounty * TICKS_PER_WEEK),
  );
  const stageLength = trainingTicks + productionTicks;

  return {
    workload,
    trainingTicks,
    productionTicks,
    stageLength,
    countiesCompletedInt: 0,
    propertiesCompleted: 0,
  } satisfies TierState;
}

function assignWorkersToTier(
  tierState: TierState,
  stageCounts: number[],
  context: WorkerContext,
) {
  const activeInProgress = stageCounts.reduce((sum, count) => sum + count, 0);
  const countiesStarted = Math.min(
    tierState.workload.countiesNeeded,
    tierState.countiesCompletedInt + activeInProgress,
  );
  let remainingToStart = tierState.workload.countiesNeeded - countiesStarted;
  if (remainingToStart <= 0) {
    return;
  }

  const fromIdle = Math.min(context.idleWorkers, remainingToStart);
  if (fromIdle > 0) {
    stageCounts[0] += fromIdle;
    context.idleWorkers -= fromIdle;
    remainingToStart -= fromIdle;
  }

  if (remainingToStart <= 0) {
    return;
  }

  const remainingNewCapacity = Math.max(
    0,
    context.totalWorkerLimit - context.totalNewPeople,
  );
  const remainingWeeklyCapacity = Math.max(
    0,
    MAX_NEW_PEOPLE_PER_WEEK - context.newPeopleThisWeek,
  );
  const newStarters = Math.min(
    remainingToStart,
    remainingNewCapacity,
    remainingWeeklyCapacity,
  );

  if (newStarters > 0) {
    stageCounts[0] += newStarters;
    context.totalNewPeople += newStarters;
    context.newPeopleThisWeek += newStarters;
  }
}

function calculateLabor(
  workloads: TierWorkload[],
  totalProperties: number,
  maxTotalWorkers?: number,
): {
  laborCost: number;
  counties: number;
  weeks: number;
  peoplePerWeek: number[];
  heartbeatPeoplePerWeek: number[];
} {
  const totalCountiesFloat = workloads.reduce(
    (sum, workload) => sum + workload.countiesFloat,
    0,
  );

  if (workloads.length === 0) {
    return {
      laborCost: 0,
      counties: totalCountiesFloat,
      weeks: 0,
      peoplePerWeek: [],
      heartbeatPeoplePerWeek: [],
    };
  }

  const workerContext: WorkerContext = {
    idleWorkers: 0,
    newPeopleThisWeek: 0,
    totalNewPeople: 0,
    totalWorkerLimit: maxTotalWorkers ?? DEFAULT_MAX_TOTAL_WORKERS,
  };

  let tierIndex = 0;
  let currentTierState: TierState | undefined = initializeTierState(
    workloads[tierIndex],
  );
  let stageCounts = new Array(currentTierState.stageLength).fill(0);
  assignWorkersToTier(currentTierState, stageCounts, workerContext);

  const peoplePerWeek: number[] = [];
  const heartbeatPeoplePerWeek: number[] = [];
  let laborCost = 0;
  let propertiesCompleted = 0;
  let heartbeatPeople = 0;
  let tickCount = 0;
  let weekTickCounter = 0;
  let accumulatedActiveWorkers = 0;

  const tickDuration = 1 / TICKS_PER_WEEK;

  while (currentTierState) {
    assignWorkersToTier(currentTierState, stageCounts, workerContext);

    const activeWorkers = stageCounts.reduce((sum, count) => sum + count, 0);
    const tierFinished =
      currentTierState.countiesCompletedInt >=
        currentTierState.workload.countiesNeeded &&
      activeWorkers === 0;

    if (tierFinished) {
      tierIndex++;
      if (tierIndex >= workloads.length) {
        break;
      }
      currentTierState = initializeTierState(workloads[tierIndex]);
      stageCounts = new Array(currentTierState.stageLength).fill(0);
      assignWorkersToTier(currentTierState, stageCounts, workerContext);
      continue;
    }

    if (activeWorkers === 0) {
      break;
    }

    tickCount++;
    weekTickCounter++;
    accumulatedActiveWorkers += activeWorkers;

    const productionWorkers = stageCounts
      .slice(currentTierState.trainingTicks)
      .reduce((sum, count) => sum + count, 0);
    laborCost += productionWorkers * COST_PER_PERSON_PER_WEEK * tickDuration;

    const finishingThisTick = stageCounts[stageCounts.length - 1];

    for (let stage = stageCounts.length - 1; stage > 0; stage--) {
      stageCounts[stage] = stageCounts[stage - 1];
    }
    stageCounts[0] = 0;

    const tierRemainingCounties = Math.max(
      0,
      currentTierState.workload.countiesNeeded -
        currentTierState.countiesCompletedInt,
    );
    const finishingCounties = Math.min(finishingThisTick, tierRemainingCounties);
    currentTierState.countiesCompletedInt += finishingCounties;

    const propertiesGain = Math.min(
      currentTierState.workload.properties -
        currentTierState.propertiesCompleted,
      finishingCounties * currentTierState.workload.tier.propertiesPerCounty,
    );
    currentTierState.propertiesCompleted += propertiesGain;
    propertiesCompleted = Math.min(
      totalProperties,
      propertiesCompleted + propertiesGain,
    );

    let returningWorkers = finishingThisTick;
    const heartbeatNeeded =
      propertiesCompleted === 0
        ? 0
        : Math.ceil(
            propertiesCompleted / HEARTBEAT_PROPERTIES_PER_PERSON_PER_WEEK,
          );
    const additionalHeartbeatNeeded = Math.max(
      0,
      heartbeatNeeded - heartbeatPeople,
    );
    const workersToHeartbeat = Math.min(
      additionalHeartbeatNeeded,
      returningWorkers,
    );
    if (workersToHeartbeat > 0) {
      heartbeatPeople += workersToHeartbeat;
      returningWorkers -= workersToHeartbeat;
    }

    const postShiftActive = stageCounts.reduce((sum, count) => sum + count, 0);
    const countiesStarted = Math.min(
      currentTierState.workload.countiesNeeded,
      currentTierState.countiesCompletedInt + postShiftActive,
    );
    let remainingToStart = currentTierState.workload.countiesNeeded - countiesStarted;

    if (returningWorkers > 0 && remainingToStart > 0) {
      const reassignments = Math.min(returningWorkers, remainingToStart);
      stageCounts[0] += reassignments;
      returningWorkers -= reassignments;
      remainingToStart -= reassignments;
    }

    if (returningWorkers > 0) {
      workerContext.idleWorkers += returningWorkers;
    }

    if (remainingToStart > 0) {
      assignWorkersToTier(currentTierState, stageCounts, workerContext);
    }

    if (weekTickCounter === TICKS_PER_WEEK) {
      peoplePerWeek.push(accumulatedActiveWorkers / TICKS_PER_WEEK);
      heartbeatPeoplePerWeek.push(heartbeatPeople);
      accumulatedActiveWorkers = 0;
      weekTickCounter = 0;
      workerContext.newPeopleThisWeek = 0;
    }
  }

  if (weekTickCounter > 0) {
    peoplePerWeek.push(accumulatedActiveWorkers / weekTickCounter);
    heartbeatPeoplePerWeek.push(heartbeatPeople);
  }

  const weeks = peoplePerWeek.length;

  return {
    laborCost,
    counties: totalCountiesFloat,
    weeks,
    peoplePerWeek,
    heartbeatPeoplePerWeek,
  };
}

function calculateHeartbeat(properties: number): HeartbeatSummary {
  const safeProperties = Math.max(0, Math.floor(properties));

  if (safeProperties === 0) {
    return {
      properties: 0,
      peopleNeeded: 0,
      weeklyLaborCost: 0,
      weeklyComputeCost: 0,
      weeklyBlockchainCost: 0,
      weeklyTotalCost: 0,
    } satisfies HeartbeatSummary;
  }

  const peopleNeeded = Math.max(
    1,
    Math.ceil(safeProperties / HEARTBEAT_PROPERTIES_PER_PERSON_PER_WEEK),
  );
  const weeklyLaborCost =
    peopleNeeded * HEARTBEAT_LABOR_COST_PER_PERSON_PER_WEEK;
  const weeklyComputeCost =
    safeProperties * HEARTBEAT_COMPUTE_COST_PER_PROPERTY;
  const weeklyBlockchainCost =
    safeProperties * HEARTBEAT_BLOCKCHAIN_COST_PER_PROPERTY;
  const weeklyTotalCost =
    weeklyLaborCost + weeklyComputeCost + weeklyBlockchainCost;

  return {
    properties: safeProperties,
    peopleNeeded,
    weeklyLaborCost,
    weeklyComputeCost,
    weeklyBlockchainCost,
    weeklyTotalCost,
  } satisfies HeartbeatSummary;
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
  const tierWorkloads = buildTierWorkloads(
    clampedProperties,
    context.startIndex,
  );
  const {
    laborCost,
    counties,
    weeks,
    peoplePerWeek,
    heartbeatPeoplePerWeek,
  } = calculateLabor(
    tierWorkloads,
    clampedProperties,
    maxTotalWorkers,
  );
  const heartbeat = calculateHeartbeat(clampedProperties);
  const totalCost =
    storageCost +
    awsComputeCost +
    blockchainGasCost +
    laborCost +
    heartbeat.weeklyTotalCost;

  const distribution = summarizeDistribution(clampedProperties, context);

  return {
    properties: clampedProperties,
    costBreakdown: {
      storage: storageCost,
      awsCompute: awsComputeCost,
      blockchainGas: blockchainGasCost,
      labor: laborCost,
      heartbeatLabor: heartbeat.weeklyLaborCost,
      heartbeatCompute: heartbeat.weeklyComputeCost,
      heartbeatBlockchain: heartbeat.weeklyBlockchainCost,
      total: totalCost,
    },
    timeline: {
      counties,
      weeks,
      peoplePerWeek,
      heartbeatPeoplePerWeek,
    },
    distribution,
    heartbeat,
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
    `    Heartbeat Labor: ${formatCurrency(result.costBreakdown.heartbeatLabor)}`,
  );
  console.log(
    `    Heartbeat CPU:   ${formatCurrency(result.costBreakdown.heartbeatCompute)}`,
  );
  console.log(
    `    Heartbeat Gas:   ${formatCurrency(result.costBreakdown.heartbeatBlockchain)}`,
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
  const heartbeatTimeline = result.timeline.heartbeatPeoplePerWeek;
  if (heartbeatTimeline.length > 0) {
    const maxHeartbeat = heartbeatTimeline.reduce(
      (max, val) => Math.max(max, val),
      0,
    );
    const maxWeek = heartbeatTimeline.findIndex((count) => count === maxHeartbeat);
    const firstActiveWeek = heartbeatTimeline.findIndex((count) => count > 0);
    const finalHeartbeat = heartbeatTimeline[heartbeatTimeline.length - 1] ?? 0;
    if (maxHeartbeat > 0) {
      const displayFirstWeek = firstActiveWeek >= 0 ? firstActiveWeek + 1 : "n/a";
      const displayMaxWeek = maxWeek >= 0 ? maxWeek + 1 : "n/a";
      console.log(
        `    Heartbeat Ramp: first active week ${displayFirstWeek}, max ${maxHeartbeat} people (week ${displayMaxWeek}), final ${finalHeartbeat} people`,
      );
    }
  }
  console.log(
    "═══════════════════════════════════════════════════\n",
  );

  console.log("  Heartbeat Maintenance:");
  console.log(
    `    Properties Covered: ${formatNumber(result.heartbeat.properties, 0)}`,
  );
  console.log(
    `    People Needed:      ${formatNumber(result.heartbeat.peopleNeeded, 0)}`,
  );
  console.log(
    `    Capitalized Cost:   ${formatCurrency(result.heartbeat.weeklyTotalCost)}`,
  );
  console.log(
    `    Weekly Run-Rate:    ${formatCurrency(result.heartbeat.weeklyTotalCost)}`,
  );
  console.log(
    `      Labor:            ${formatCurrency(result.heartbeat.weeklyLaborCost)}`,
  );
  console.log(
    `      AWS Compute:      ${formatCurrency(result.heartbeat.weeklyComputeCost)}`,
  );
  console.log(
    `      Blockchain Gas:   ${formatCurrency(result.heartbeat.weeklyBlockchainCost)}`,
  );
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

export {
  parseCliArgs,
  buildCalculationResult,
  type CliOptions,
  type CalculationResult,
  type HeartbeatSummary,
};
