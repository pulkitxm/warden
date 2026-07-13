#!/usr/bin/env bun
// Entry shim (also the `bun build --compile` entry) — all logic lives in main.ts.
import { runWnpx } from "../cli/main.ts";

process.exit(await runWnpx(Bun.argv.slice(2)));
