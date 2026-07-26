import { expect, test } from "bun:test";
import {
  entriesFromBunLock,
  LOCK_FORMATS,
  lockfilesIn,
  splitDescriptor,
  unreadableLockfilesIn,
} from "../src/lockfile.ts";

const fs = (files: Record<string, string>) => ({
  exists: (path: string) => path in files,
  readFile: (path: string) => files[path] as string,
});

test("a package name is split from its spec at the first separator, not the last", () => {
  expect(splitDescriptor("left-pad@1.3.0")).toEqual({ name: "left-pad", spec: "1.3.0" });
  expect(splitDescriptor("@fastify/jwt@9.1.0")).toEqual({ name: "@fastify/jwt", spec: "9.1.0" });
});

test("a git spec containing an at sign does not swallow the package name", () => {
  expect(splitDescriptor("pkg@git+ssh://git@github.com/owner/repo#abc123")).toEqual({
    name: "pkg",
    spec: "git+ssh://git@github.com/owner/repo#abc123",
  });
  expect(splitDescriptor("@scope/pkg@git+ssh://git@github.com/owner/repo#abc123")).toEqual({
    name: "@scope/pkg",
    spec: "git+ssh://git@github.com/owner/repo#abc123",
  });
});

test("a descriptor with no spec is not a dependency entry", () => {
  expect(splitDescriptor("left-pad")).toBeNull();
  expect(splitDescriptor("@scope/pkg")).toBeNull();
  expect(splitDescriptor("")).toBeNull();
  expect(splitDescriptor("@")).toBeNull();
});

const BUN_LOCK = `{
  "lockfileVersion": 1,
  "workspaces": { "": { "name": "root" } },
  "packages": {
    "left-pad": ["left-pad@1.3.0", "", {}, "sha512-XI5MPzVNApjAyhQzphX8Bkm"],
    "local-dep": ["local-dep@file:local-dep", {}],
    "pkg-a": ["pkg-a@workspace:pkg-a"],
    "tarball-dep": ["is-number@https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz", {}, "sha512-41Cifkg6e8TylSpdtTpe"],
    "uWebSockets.js": ["uWebSockets.js@github:uNetworking/uWebSockets.js#d39d418", {}, "uNetworking-uWebSockets.js-d39d418", "sha512-5xDCl8El6mdchTA"],
    "mirrored": ["mirrored@2.0.0", "https://registry.example.com/", {}, "sha512-mirror"],
  }
}`;

test("a bun registry entry yields its version, integrity, and registry", () => {
  const entries = entriesFromBunLock(BUN_LOCK);
  expect(entries.find((entry) => entry.name === "left-pad")).toEqual({
    name: "left-pad",
    version: "1.3.0",
    integrity: "sha512-XI5MPzVNApjAyhQzphX8Bkm",
    resolved: "https://registry.npmjs.org/",
  });
});

test("a bun entry pinned to a private registry records that registry, not the default", () => {
  const entries = entriesFromBunLock(BUN_LOCK);
  expect(entries.find((entry) => entry.name === "mirrored")?.resolved).toBe(
    "https://registry.example.com/",
  );
});

test("a bun tarball entry is read under its real name, not its alias key", () => {
  const entries = entriesFromBunLock(BUN_LOCK);
  expect(entries.find((entry) => entry.name === "is-number")).toEqual({
    name: "is-number",
    integrity: "sha512-41Cifkg6e8TylSpdtTpe",
    resolved: "https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz",
  });
});

test("a bun git entry takes the hash for integrity and skips the bun tag", () => {
  const entries = entriesFromBunLock(BUN_LOCK);
  expect(entries.find((entry) => entry.name === "uWebSockets.js")).toEqual({
    name: "uWebSockets.js",
    integrity: "sha512-5xDCl8El6mdchTA",
    resolved: "github:uNetworking/uWebSockets.js#d39d418",
  });
});

test("bun workspace and local entries are not treated as fetched artifacts", () => {
  const names = entriesFromBunLock(BUN_LOCK).map((entry) => entry.name);
  expect(names).not.toContain("pkg-a");
  expect(names).toContain("local-dep");
  expect(entriesFromBunLock(BUN_LOCK).find((entry) => entry.name === "local-dep")).toEqual({
    name: "local-dep",
    resolved: "file:local-dep",
  });
});

test("a bun lockfile with a non-array entry is skipped rather than crashing", () => {
  expect(entriesFromBunLock('{"packages":{"weird":{"version":"1.0.0"}}}')).toEqual([]);
  expect(entriesFromBunLock('{"packages":{"weird":[1,2]}}')).toEqual([]);
  expect(entriesFromBunLock("{}")).toEqual([]);
});

test("every lockfile warden claims to read has a parser", () => {
  expect(LOCK_FORMATS.map((format) => format.file)).toEqual([
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
  ]);
});

test("only the lockfiles actually present in a project are read", () => {
  const present = lockfilesIn(
    fs({ "/repo/bun.lock": BUN_LOCK, "/repo/package.json": "{}" }),
    "/repo",
  );
  expect(present.map((format) => format.file)).toEqual(["bun.lock"]);
});

test("a binary lockfile is reported with the command that converts it", () => {
  const notes = unreadableLockfilesIn(fs({ "/repo/bun.lockb": "binary" }), "/repo");
  expect(notes).toHaveLength(1);
  expect(notes[0]).toContain("bun install --save-text-lockfile");
  expect(unreadableLockfilesIn(fs({ "/repo/bun.lock": BUN_LOCK }), "/repo")).toEqual([]);
});
