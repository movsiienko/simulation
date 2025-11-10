import { test, expect, describe, mock } from "bun:test";
import { parseCliArgs, buildCalculationResult } from "./cli";

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
    });
  });

  test("should parse properties argument with short flag", () => {
    withMockedArgv(["bun", "cli.ts", "-p", "50"], () => {
      const result = parseCliArgs();
      expect(result.properties).toBe(50);
    });
  });

  test("should parse data group, extracted properties, and max workers", () => {
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
      ],
      () => {
        const result = parseCliArgs();
        expect(result.properties).toBe(75);
        expect(result.dataGroup).toBe("school");
        expect(result.extractedProperties).toBe(10);
        expect(result.maxTotalWorkers).toBe(8);
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
});
