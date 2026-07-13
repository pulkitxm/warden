#!/usr/bin/env bun
import { runWnpx } from "../cli/main.ts";

process.exit(await runWnpx(Bun.argv.slice(2)));
