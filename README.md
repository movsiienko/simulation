# simulation

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

The CLI logic lives in `cli.ts`. You can pass the usual extraction inputs plus `--parallel-data-groups <count>` (or `-c <count>`) to scale the plan across multiple data groups processed simultaneously. Example:

```bash
bun run cli.ts --properties 5000000 --parallel-data-groups 3
```

This project was created using `bun init` in bun v1.2.22. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
