import { test, expect, describe, mock } from "bun:test";
import { parseCliArgs, type CliOptions } from "./cli";

describe("CLI Argument Parsing", () => {
  test("should parse tokens argument", () => {
    const originalArgv = Bun.argv;
    Bun.argv = ["bun", "cli.ts", "--tokens", "100"];
    
    const result = parseCliArgs();
    
    expect(result.tokens).toBe(100);
    expect(result.usd).toBeUndefined();
    
    Bun.argv = originalArgv;
  });

  test("should parse tokens argument with short flag", () => {
    const originalArgv = Bun.argv;
    Bun.argv = ["bun", "cli.ts", "-t", "50.5"];
    
    const result = parseCliArgs();
    
    expect(result.tokens).toBe(50.5);
    expect(result.usd).toBeUndefined();
    
    Bun.argv = originalArgv;
  });

  test("should parse usd argument", () => {
    const originalArgv = Bun.argv;
    Bun.argv = ["bun", "cli.ts", "--usd", "200"];
    
    const result = parseCliArgs();
    
    expect(result.usd).toBe(200);
    expect(result.tokens).toBeUndefined();
    
    Bun.argv = originalArgv;
  });

  test("should parse usd argument with short flag", () => {
    const originalArgv = Bun.argv;
    Bun.argv = ["bun", "cli.ts", "-u", "75.25"];
    
    const result = parseCliArgs();
    
    expect(result.usd).toBe(75.25);
    expect(result.tokens).toBeUndefined();
    
    Bun.argv = originalArgv;
  });

  test("should reject when neither tokens nor usd is provided", () => {
    const originalArgv = Bun.argv;
    const originalExit = process.exit;
    const originalError = console.error;
    
    let exitCode: number | undefined;
    let errorMessage = "";
    
    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("exit called");
    });
    
    console.error = mock((message: string) => {
      errorMessage = message;
    });
    
    Bun.argv = ["bun", "cli.ts"];
    
    try {
      parseCliArgs();
    } catch (e) {
      // Expected to throw due to process.exit mock
    }
    
    expect(exitCode).toBe(1);
    expect(errorMessage).toContain("Either --tokens (-t) or --usd (-u) must be provided");
    
    Bun.argv = originalArgv;
    process.exit = originalExit;
    console.error = originalError;
  });

  test("should reject when both tokens and usd are provided", () => {
    const originalArgv = Bun.argv;
    const originalExit = process.exit;
    const originalError = console.error;
    
    let exitCode: number | undefined;
    let errorMessage = "";
    
    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("exit called");
    });
    
    console.error = mock((message: string) => {
      errorMessage = message;
    });
    
    Bun.argv = ["bun", "cli.ts", "--tokens", "100", "--usd", "200"];
    
    try {
      parseCliArgs();
    } catch (e) {
      // Expected to throw due to process.exit mock
    }
    
    expect(exitCode).toBe(1);
    expect(errorMessage).toContain("Only one of --tokens (-t) or --usd (-u) can be provided");
    
    Bun.argv = originalArgv;
    process.exit = originalExit;
    console.error = originalError;
  });

  test("should handle decimal values for tokens", () => {
    const originalArgv = Bun.argv;
    Bun.argv = ["bun", "cli.ts", "--tokens", "123.456"];
    
    const result = parseCliArgs();
    
    expect(result.tokens).toBe(123.456);
    
    Bun.argv = originalArgv;
  });

  test("should handle decimal values for usd", () => {
    const originalArgv = Bun.argv;
    Bun.argv = ["bun", "cli.ts", "--usd", "99.99"];
    
    const result = parseCliArgs();
    
    expect(result.usd).toBe(99.99);
    
    Bun.argv = originalArgv;
  });

  test("should handle zero values", () => {
    const originalArgv = Bun.argv;
    Bun.argv = ["bun", "cli.ts", "--tokens", "0"];
    
    const result = parseCliArgs();
    
    expect(result.tokens).toBe(0);
    expect(result.extractedProperties).toBe(0);
    expect(result.dataGroup).toBe("county");
    
    Bun.argv = originalArgv;
  });

  test("should parse data group and extracted properties", () => {
    const originalArgv = Bun.argv;
    Bun.argv = [
      "bun",
      "cli.ts",
      "--tokens",
      "50",
      "--data-group",
      "County",
      "--extracted-properties",
      "10",
      "--max-workers",
      "8",
    ];

    const result = parseCliArgs();

    expect(result.tokens).toBe(50);
    expect(result.dataGroup).toBe("county");
    expect(result.extractedProperties).toBe(10);
    expect(result.maxWorkersPerWeek).toBe(8);

    Bun.argv = originalArgv;
  });

  test("should parse max workers with short flag", () => {
    const originalArgv = Bun.argv;
    Bun.argv = ["bun", "cli.ts", "--usd", "100", "-w", "12"];

    const result = parseCliArgs();

    expect(result.usd).toBe(100);
    expect(result.maxWorkersPerWeek).toBe(12);

    Bun.argv = originalArgv;
  });

  test("should reject invalid token values", () => {
    const originalArgv = Bun.argv;
    const originalExit = process.exit;
    const originalError = console.error;
    
    let exitCode: number | undefined;
    let errorMessage = "";
    
    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("exit called");
    });
    
    console.error = mock((message: string) => {
      errorMessage = message;
    });
    
    Bun.argv = ["bun", "cli.ts", "--tokens", "invalid"];
    
    try {
      parseCliArgs();
    } catch (e) {
      // Expected to throw due to process.exit mock
    }
    
    expect(exitCode).toBe(1);
    expect(errorMessage).toContain("Invalid token amount");
    
    Bun.argv = originalArgv;
    process.exit = originalExit;
    console.error = originalError;
  });

  test("should reject invalid usd values", () => {
    const originalArgv = Bun.argv;
    const originalExit = process.exit;
    const originalError = console.error;
    
    let exitCode: number | undefined;
    let errorMessage = "";
    
    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("exit called");
    });
    
    console.error = mock((message: string) => {
      errorMessage = message;
    });
    
    Bun.argv = ["bun", "cli.ts", "--usd", "not-a-number"];
    
    try {
      parseCliArgs();
    } catch (e) {
      // Expected to throw due to process.exit mock
    }
    
    expect(exitCode).toBe(1);
    expect(errorMessage).toContain("Invalid USD amount");
    
    Bun.argv = originalArgv;
    process.exit = originalExit;
    console.error = originalError;
  });

  test("should reject unsupported data group", () => {
    const originalArgv = Bun.argv;
    const originalExit = process.exit;
    const originalError = console.error;

    let exitCode: number | undefined;
    let errorMessage = "";

    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("exit called");
    });

    console.error = mock((message: string) => {
      errorMessage = message;
    });

    Bun.argv = [
      "bun",
      "cli.ts",
      "--tokens",
      "10",
      "--data-group",
      "city",
    ];

    try {
      parseCliArgs();
    } catch (e) {
      // Expected to throw due to process.exit mock
    }

    expect(exitCode).toBe(1);
    expect(errorMessage).toContain("Unsupported data group");

    Bun.argv = originalArgv;
    process.exit = originalExit;
    console.error = originalError;
  });

  test("should reject non-integer extracted properties", () => {
    const originalArgv = Bun.argv;
    const originalExit = process.exit;
    const originalError = console.error;

    let exitCode: number | undefined;
    let errorMessage = "";

    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("exit called");
    });

    console.error = mock((message: string) => {
      errorMessage = message;
    });

    Bun.argv = [
      "bun",
      "cli.ts",
      "--tokens",
      "10",
      "--extracted-properties",
      "1.5",
    ];

    try {
      parseCliArgs();
    } catch (e) {
      // Expected to throw due to process.exit mock
    }

    expect(exitCode).toBe(1);
    expect(errorMessage).toContain("Extracted properties must be a whole number");

    Bun.argv = originalArgv;
    process.exit = originalExit;
    console.error = originalError;
  });

  test("should reject invalid max workers value", () => {
    const originalArgv = Bun.argv;
    const originalExit = process.exit;
    const originalError = console.error;

    let exitCode: number | undefined;
    let errorMessage = "";

    process.exit = mock((code?: number) => {
      exitCode = code;
      throw new Error("exit called");
    });

    console.error = mock((message: string) => {
      errorMessage = message;
    });

    Bun.argv = ["bun", "cli.ts", "--tokens", "10", "--max-workers", "0"];

    try {
      parseCliArgs();
    } catch (e) {
      // Expected to throw due to process.exit mock
    }

    expect(exitCode).toBe(1);
    expect(errorMessage).toContain("Invalid max workers value");

    Bun.argv = originalArgv;
    process.exit = originalExit;
    console.error = originalError;
  });
});
