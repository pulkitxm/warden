#!/usr/bin/env bun
// Entry shim (also the `bun build --compile` entry) — all logic lives in main.ts.
import { runWnpm } from "./main.ts";

process.exit(await runWnpm(Bun.argv.slice(2)));
