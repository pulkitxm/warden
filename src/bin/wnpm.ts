#!/usr/bin/env bun
import { runWnpm } from "../cli/main.ts";

process.exit(await runWnpm(Bun.argv.slice(2)));
