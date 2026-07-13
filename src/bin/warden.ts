#!/usr/bin/env bun
import { runWarden } from "../cli/main.ts";

process.exit(await runWarden(Bun.argv.slice(2)));
