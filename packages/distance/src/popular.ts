/**
 * Popular npm package names with approximate weekly downloads.
 *
 * Serves two jobs: typosquat targets, and the establishment fallback used when
 * the downloads API is unavailable (so a network blip can't flip a known-popular
 * package to "not established" and false-block it — see issue I10). A committed
 * real top-10k snapshot drops in here as JSON without touching the algorithm.
 */
export interface PopularPackage {
  name: string;
  weekly: number;
}

const M = 1_000_000;

export const POPULAR: PopularPackage[] = [
  { name: "react", weekly: 25 * M }, { name: "react-dom", weekly: 24 * M },
  { name: "lodash", weekly: 300 * M }, { name: "axios", weekly: 100 * M },
  { name: "chalk", weekly: 300 * M }, { name: "debug", weekly: 358 * M },
  { name: "express", weekly: 30 * M }, { name: "commander", weekly: 150 * M },
  { name: "is-odd", weekly: 2 * M }, { name: "is-even", weekly: 1 * M },
  { name: "chokidar", weekly: 60 * M }, { name: "dotenv", weekly: 40 * M },
  { name: "colors", weekly: 25 * M }, { name: "classnames", weekly: 12 * M },
  { name: "cross-env", weekly: 12 * M }, { name: "node-fetch", weekly: 45 * M },
  { name: "typescript", weekly: 70 * M }, { name: "webpack", weekly: 30 * M },
  { name: "next", weekly: 8 * M }, { name: "vue", weekly: 5 * M },
  { name: "eslint", weekly: 40 * M }, { name: "moment", weekly: 20 * M },
  { name: "ansi-styles", weekly: 300 * M }, { name: "jest", weekly: 30 * M },
  { name: "rimraf", weekly: 60 * M }, { name: "glob", weekly: 90 * M },
  { name: "uuid", weekly: 130 * M }, { name: "semver", weekly: 200 * M },
  { name: "yargs", weekly: 80 * M }, { name: "prettier", weekly: 30 * M },
  { name: "request", weekly: 10 * M }, { name: "got", weekly: 20 * M },
  { name: "undici", weekly: 30 * M }, { name: "koa", weekly: 3 * M },
  { name: "fastify", weekly: 3 * M }, { name: "svelte", weekly: 3 * M },
  { name: "rollup", weekly: 30 * M }, { name: "vite", weekly: 30 * M },
  { name: "vitest", weekly: 10 * M }, { name: "esbuild", weekly: 40 * M },
  { name: "sharp", weekly: 10 * M }, { name: "bcrypt", weekly: 2 * M },
  { name: "node-gyp", weekly: 60 * M }, { name: "core-js", weekly: 50 * M },
  { name: "three", weekly: 2 * M }, { name: "d3", weekly: 12 * M },
  { name: "zod", weekly: 20 * M }, { name: "ws", weekly: 90 * M },
  { name: "qs", weekly: 100 * M }, { name: "ms", weekly: 200 * M },
  { name: "mkdirp", weekly: 80 * M }, { name: "async", weekly: 60 * M },
  { name: "bluebird", weekly: 40 * M }, { name: "underscore", weekly: 30 * M },
  { name: "jquery", weekly: 15 * M }, { name: "redux", weekly: 10 * M },
  { name: "react-redux", weekly: 8 * M }, { name: "styled-components", weekly: 6 * M },
  { name: "tslib", weekly: 150 * M }, { name: "minimist", weekly: 100 * M },
  { name: "cheerio", weekly: 8 * M }, { name: "puppeteer", weekly: 4 * M },
  { name: "playwright", weekly: 8 * M }, { name: "socket.io", weekly: 6 * M },
  { name: "mongoose", weekly: 4 * M }, { name: "pg", weekly: 8 * M },
  { name: "mysql", weekly: 2 * M }, { name: "redis", weekly: 6 * M },
  { name: "winston", weekly: 12 * M }, { name: "pino", weekly: 8 * M },
  { name: "nodemon", weekly: 6 * M }, { name: "ts-node", weekly: 20 * M },
  { name: "webpack-cli", weekly: 12 * M }, { name: "babel-loader", weekly: 12 * M },
  { name: "postcss", weekly: 90 * M }, { name: "autoprefixer", weekly: 30 * M },
  { name: "tailwindcss", weekly: 12 * M }, { name: "sass", weekly: 15 * M },
  { name: "dayjs", weekly: 25 * M }, { name: "date-fns", weekly: 20 * M },
  { name: "ramda", weekly: 12 * M }, { name: "immer", weekly: 12 * M },
  { name: "rxjs", weekly: 40 * M }, { name: "graphql", weekly: 20 * M },
  { name: "apollo-server", weekly: 1 * M }, { name: "nestjs", weekly: 3 * M },
  { name: "nanoid", weekly: 40 * M }, { name: "cors", weekly: 30 * M },
  { name: "body-parser", weekly: 30 * M }, { name: "helmet", weekly: 5 * M },
  { name: "jsonwebtoken", weekly: 20 * M }, { name: "passport", weekly: 3 * M },
  { name: "validator", weekly: 15 * M }, { name: "joi", weekly: 12 * M },
  { name: "yup", weekly: 12 * M }, { name: "axios-retry", weekly: 2 * M },
  { name: "form-data", weekly: 60 * M }, { name: "form-data-encoder", weekly: 5 * M },
  { name: "fs-extra", weekly: 90 * M }, { name: "execa", weekly: 60 * M },
  { name: "globby", weekly: 40 * M }, { name: "ora", weekly: 30 * M },
  { name: "inquirer", weekly: 30 * M }, { name: "chokidar-cli", weekly: 1 * M },
  { name: "concurrently", weekly: 8 * M }, { name: "npm-run-all", weekly: 8 * M },
  { name: "husky", weekly: 12 * M }, { name: "lint-staged", weekly: 8 * M },
];
