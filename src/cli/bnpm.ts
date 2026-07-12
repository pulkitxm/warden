#!/usr/bin/env node
import { rewriteArgv } from "./alias.js";
import { runAndExit } from "./bin.js";

runAndExit(rewriteArgv(process.argv.slice(2), "install", ["install", "i", "add"]));
