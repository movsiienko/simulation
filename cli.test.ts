import { test, expect, describe, mock } from "bun:test";
import {
  parseCliArgs,
  buildCalculationResult,
  summarizeParallelExecution,
} from "./cli";

function withMockedArgv(argv: string[], fn: () => void) {
  const originalArgv = Bun.argv;
  Bun.argv = argv;
  try {
    fn();
  } finally {
    Bun.argv = originalArgv;
  }
}

function withMockedExit(
  fn: (ctx: { exitCode?: number; errorMessage?: string }) => void,
) {
  const originalExit = process.exit;
  const originalError = console.error;

  const ctx: { exitCode?: number; errorMessage?: string } = {};

  process.exit = mock((code?: number) => {
    ctx.exitCode = code;
    throw new Error("exit called");
  });

  console.error = mock((message: string) => {
    ctx.errorMessage = message;
  });

  try {
    fn(ctx);
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }
}

describe("CLI Argument Parsing", () => {
  test("should parse properties argument", () => {
    withMockedArgv(["bun", "cli.ts", "--properties", "100"], () => {
      const result = parseCliArgs();
      expect(result.properties).toBe(100);
      expect(result.dataGroup).toBe("county");
      expect(result.extractedProperties).toBe(0);
      expect(result.parallelDataGroups).toBe(1);
    });
  });

  test("should parse properties argument with short flag", () => {
    withMockedArgv(["bun", "cli.ts", "-p", "50"], () => {
      const result = parseCliArgs();
      expect(result.properties).toBe(50);
    });
  });

  test("should parse data group, extracted properties, max workers, and onboarding cap", () => {
    withMockedArgv(
      [
        "bun",
        "cli.ts",
        "--properties",
        "75",
        "--data-group",
        "School",
        "--extracted-properties",
        "10",
        "--max-workers",
        "8",
        "--max-new-people",
        "7",
      ],
      () => {
        const result = parseCliArgs();
        expect(result.properties).toBe(75);
        expect(result.dataGroup).toBe("school");
        expect(result.extractedProperties).toBe(10);
        expect(result.maxTotalWorkers).toBe(8);
        expect(result.maxNewPeoplePerWeek).toBe(7);
      },
    );
  });

  test("should accept short flag for max workers", () => {
    withMockedArgv(
      ["bun", "cli.ts", "--properties", "40", "-w", "12"],
      () => {
        const result = parseCliArgs();
        expect(result.maxTotalWorkers).toBe(12);
      },
    );
  });

  test("should accept short flag for max new people", () => {
    withMockedArgv(
      ["bun", "cli.ts", "--properties", "40", "-n", "3"],
      () => {
        const result = parseCliArgs();
        expect(result.maxNewPeoplePerWeek).toBe(3);
      },
    );
  });

  test("should parse training and extraction price overrides", () => {
    withMockedArgv(
      [
        "bun",
        "cli.ts",
        "--properties",
        "40",
        "--training-price",
        "750",
        "--extraction-price",
        "3100",
      ],
      () => {
        const result = parseCliArgs();
        expect(result.trainingCostPerPersonPerWeek).toBe(750);
        expect(result.extractionCostPerPersonPerWeek).toBe(3100);
      },
    );
  });

  test("should accept parallel data groups via long flag", () => {
    withMockedArgv(
      [
        "bun",
        "cli.ts",
        "--properties",
        "40",
        "--parallel-data-groups",
        "3",
      ],
      () => {
        const result = parseCliArgs();
        expect(result.parallelDataGroups).toBe(3);
      },
    );
  });

  test("should accept parallel data groups via short flag", () => {
    withMockedArgv(
      ["bun", "cli.ts", "--properties", "40", "-c", "2"],
      () => {
        const result = parseCliArgs();
        expect(result.parallelDataGroups).toBe(2);
      },
    );
  });

  test("should require properties value", () => {
    withMockedExit((ctx) => {
      withMockedArgv(["bun", "cli.ts"], () => {
        expect(() => parseCliArgs()).toThrow("exit called");
        expect(ctx.exitCode).toBe(1);
        expect(ctx.errorMessage).toContain("--properties (-p) is required");
      });
    });
  });

  test("should reject non-integer properties", () => {
    withMockedExit((ctx) => {
      withMockedArgv(["bun", "cli.ts", "--properties", "10.5"], () => {
        expect(() => parseCliArgs()).toThrow("exit called");
        expect(ctx.exitCode).toBe(1);
        expect(ctx.errorMessage).toContain("Properties count must be a whole number");
      });
    });
  });

  test("should reject zero or negative properties", () => {
    withMockedExit((ctx) => {
      withMockedArgv(["bun", "cli.ts", "--properties", "0"], () => {
        expect(() => parseCliArgs()).toThrow("exit called");
        expect(ctx.exitCode).toBe(1);
        expect(ctx.errorMessage).toContain("Invalid properties count");
      });
    });
  });

  test("should reject unsupported data group", () => {
    withMockedExit((ctx) => {
      withMockedArgv(
        ["bun", "cli.ts", "--properties", "10", "--data-group", "city"],
        () => {
          expect(() => parseCliArgs()).toThrow("exit called");
          expect(ctx.exitCode).toBe(1);
          expect(ctx.errorMessage).toContain("Unsupported data group");
        },
      );
    });
  });

  test("should reject non-integer extracted properties", () => {
    withMockedExit((ctx) => {
      withMockedArgv(
        [
          "bun",
          "cli.ts",
          "--properties",
          "10",
          "--extracted-properties",
          "1.5",
        ],
        () => {
          expect(() => parseCliArgs()).toThrow("exit called");
          expect(ctx.exitCode).toBe(1);
          expect(ctx.errorMessage).toContain(
            "Extracted properties must be a whole number",
          );
        },
      );
    });
  });

  test("should reject when properties exceed remaining capacity", () => {
    withMockedExit((ctx) => {
      withMockedArgv(
        [
          "bun",
          "cli.ts",
          "--properties",
          "2",
          "--extracted-properties",
          "149999999",
        ],
        () => {
          expect(() => parseCliArgs()).toThrow("exit called");
          expect(ctx.exitCode).toBe(1);
          expect(ctx.errorMessage).toContain("Requested properties");
        },
      );
    });
  });

  test("should reject invalid max workers value", () => {
    withMockedExit((ctx) => {
      withMockedArgv(
        ["bun", "cli.ts", "--properties", "10", "--max-workers", "0"],
        () => {
          expect(() => parseCliArgs()).toThrow("exit called");
          expect(ctx.exitCode).toBe(1);
          expect(ctx.errorMessage).toContain("Invalid max workers value");
        },
      );
    });
  });

  test("should reject invalid parallel data groups value", () => {
    withMockedExit((ctx) => {
      withMockedArgv(
        ["bun", "cli.ts", "--properties", "10", "--parallel-data-groups", "0"],
        () => {
          expect(() => parseCliArgs()).toThrow("exit called");
          expect(ctx.exitCode).toBe(1);
          expect(ctx.errorMessage).toContain("Invalid parallel data groups value");
        },
      );
    });
  });

  test("should reject invalid max new people value", () => {
    withMockedExit((ctx) => {
      withMockedArgv(
        [
          "bun",
          "cli.ts",
          "--properties",
          "10",
          "--max-new-people=-1",
        ],
        () => {
          expect(() => parseCliArgs()).toThrow("exit called");
          expect(ctx.exitCode).toBe(1);
          expect(ctx.errorMessage).toContain("Invalid max new people value");
        },
      );
    });
  });

  test("should reject negative training price", () => {
    withMockedExit((ctx) => {
      withMockedArgv(
        [
          "bun",
          "cli.ts",
          "--properties",
          "10",
          "--training-price=-1",
        ],
        () => {
          expect(() => parseCliArgs()).toThrow("exit called");
          expect(ctx.exitCode).toBe(1);
          expect(ctx.errorMessage).toContain("Invalid training price");
        },
      );
    });
  });
});

describe("Cost configuration overrides", () => {
  test("charges training stages when price provided", () => {
    const baseline = buildCalculationResult({
      properties: 10_000_000,
      context: { startIndex: 0, dataGroup: { label: "County" } },
    });

    const withTrainingCost = buildCalculationResult({
      properties: 10_000_000,
      context: { startIndex: 0, dataGroup: { label: "County" } },
      trainingCostPerPersonPerWeek: 1000,
    });

    expect(withTrainingCost.costBreakdown.labor).toBeGreaterThan(
      baseline.costBreakdown.labor,
    );
  });

  test("heartbeat labor cost follows extraction rate override", () => {
    const extractionRate = 4000;
    const result = buildCalculationResult({
      properties: 10_000_000,
      context: { startIndex: 0, dataGroup: { label: "County" } },
      extractionCostPerPersonPerWeek: extractionRate,
    });

    expect(result.costBreakdown.heartbeatLabor).toBe(
      result.heartbeat.peopleNeeded * extractionRate,
    );
  });
});

describe("Heartbeat calculations", () => {
  test("capitalizes first-week costs and reports run-rate", () => {
    const result = buildCalculationResult({
      properties: 10_000_000,
      context: { startIndex: 0, dataGroup: { label: "County" } },
    });

    expect(result.heartbeat.peopleNeeded).toBe(2);
    expect(result.costBreakdown.heartbeatLabor).toBe(5000);
    expect(result.costBreakdown.heartbeatCompute).toBeCloseTo(3000);
    expect(result.costBreakdown.heartbeatBlockchain).toBeCloseTo(13000);
    expect(result.heartbeat.weeklyTotalCost).toBeCloseTo(21000);
    expect(result.timeline.heartbeatPeoplePerWeek.at(-1)).toBe(
      result.heartbeat.peopleNeeded,
    );
    expect(result.costBreakdown.total).toBeCloseTo(
      result.costBreakdown.storage +
        result.costBreakdown.awsCompute +
        result.costBreakdown.blockchainGas +
        result.costBreakdown.labor +
        result.costBreakdown.heartbeatLabor +
        result.costBreakdown.heartbeatCompute +
        result.costBreakdown.heartbeatBlockchain,
    );
  });

  test("heartbeat staffing slows large extraction timelines", () => {
    const result = buildCalculationResult({
      properties: 150_000_000,
      context: { startIndex: 0, dataGroup: { label: "County" } },
    });

    expect(result.timeline.weeks).toBe(62);
    expect(result.timeline.heartbeatPeoplePerWeek.some((count) => count > 0)).toBe(
      true,
    );
    expect(result.timeline.heartbeatPeoplePerWeek.at(-1)).toBe(
      result.heartbeat.peopleNeeded,
    );
    expect(result.timeline.heartbeatPeoplePerWeek.at(-1)).toBe(30);
    const schedule = result.timeline.peoplePerWeek;
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i]).toBeGreaterThanOrEqual(schedule[i - 1]);
    }
  });
});

describe("Parallel execution summary", () => {
  test("scales costs, resources, and properties", () => {
    const base = buildCalculationResult({
      properties: 10_000_000,
      context: { startIndex: 0, dataGroup: { label: "County" } },
    });

    const summary = summarizeParallelExecution(base, 3);

    expect(summary.dataGroups).toBe(3);
    expect(summary.totalProperties).toBe(base.properties * 3);
    expect(summary.costBreakdown.total).toBeCloseTo(
      base.costBreakdown.total * 3,
    );
    expect(summary.costBreakdown.storage).toBeCloseTo(
      base.costBreakdown.storage * 3,
    );
    expect(summary.timeline.counties).toBeCloseTo(
      base.timeline.counties * 3,
    );
    expect(summary.timeline.weeks).toBe(base.timeline.weeks);
    if (base.timeline.peoplePerWeek.length > 0) {
      expect(summary.timeline.peoplePerWeek.length).toBe(
        base.timeline.peoplePerWeek.length,
      );
      expect(summary.timeline.peoplePerWeek[0]).toBeCloseTo(
        base.timeline.peoplePerWeek[0] * 3,
      );
    }
    expect(summary.heartbeat.peopleNeeded).toBe(
      base.heartbeat.peopleNeeded * 3,
    );
    expect(summary.heartbeat.weeklyTotalCost).toBeCloseTo(
      base.heartbeat.weeklyTotalCost * 3,
    );
  });
});
