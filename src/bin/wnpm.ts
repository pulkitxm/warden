#!/usr/bin/env bun
import { runWnpm } from "../cli/main.ts";
import { withProgress } from "../shared/progress.ts";

process.exit(await withProgress(() => runWnpm(Bun.argv.slice(2))));
