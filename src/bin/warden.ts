#!/usr/bin/env bun
import { runWarden } from "../cli/main.ts";
import { withProgress } from "../shared/progress.ts";

process.exit(await withProgress(() => runWarden(Bun.argv.slice(2))));
