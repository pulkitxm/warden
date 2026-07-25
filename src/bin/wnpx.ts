#!/usr/bin/env bun
import { runWnpx } from "../cli/main.ts";
import { withProgress } from "../shared/progress.ts";

process.exit(await withProgress(() => runWnpx(Bun.argv.slice(2))));
