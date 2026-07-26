import { createHash } from "node:crypto";
import { join } from "node:path";

export type ApprovalScope = "repo" | "user";

export interface ScriptApproval {
  schema_version: 1;
  package: string;
  version: string;
  integrity: string;
  hook: string;
  script_hash: string;
  scope: ApprovalScope;
  approved_at: string;
  approver?: string;
  note?: string;
}

export interface ApprovalStore {
  schema_version: 1;
  approvals: ScriptApproval[];
}

export interface ApprovalRequest {
  package: string;
  version: string;
  integrity: string;
  hook: string;
  script: string;
}

export interface ApprovalFs {
  exists: (path: string) => boolean;
  readFile: (path: string) => string;
  writeFile: (path: string, data: string) => unknown;
  mkdir: (path: string) => unknown;
}

export const REPO_APPROVALS = join(".warden", "approvals.json");
export const USER_APPROVALS = join(".warden", "approvals.json");

export function hashScript(script: string): string {
  return `sha256:${createHash("sha256").update(script.trim()).digest("hex").slice(0, 32)}`;
}

export function approvalPath(scope: ApprovalScope, root: string, home: string): string {
  return scope === "repo" ? join(root, REPO_APPROVALS) : join(home, USER_APPROVALS);
}

export function readApprovals(fs: ApprovalFs, path: string): ScriptApproval[] {
  if (!fs.exists(path)) return [];
  try {
    const store = JSON.parse(fs.readFile(path)) as ApprovalStore;
    return Array.isArray(store.approvals) ? store.approvals : [];
  } catch {
    return [];
  }
}

export function collectApprovals(
  fs: ApprovalFs,
  root: string,
  home: string,
  requireRepoScope = false,
): ScriptApproval[] {
  const repo = readApprovals(fs, approvalPath("repo", root, home));
  if (requireRepoScope) return repo;
  return [...repo, ...readApprovals(fs, approvalPath("user", root, home))];
}

export function matchesApproval(approval: ScriptApproval, request: ApprovalRequest): boolean {
  return (
    approval.package === request.package &&
    approval.version === request.version &&
    approval.integrity === request.integrity &&
    approval.hook === request.hook &&
    approval.script_hash === hashScript(request.script)
  );
}

export function findApproval(
  approvals: ScriptApproval[],
  request: ApprovalRequest,
): ScriptApproval | undefined {
  return approvals.find((approval) => matchesApproval(approval, request));
}

export function recordApproval(
  fs: ApprovalFs,
  path: string,
  approval: ScriptApproval,
): ScriptApproval[] {
  const existing = readApprovals(fs, path).filter(
    (entry) =>
      !(
        entry.package === approval.package &&
        entry.version === approval.version &&
        entry.hook === approval.hook
      ),
  );
  const approvals = [...existing, approval].sort((a, b) =>
    `${a.package}@${a.version}#${a.hook}`.localeCompare(`${b.package}@${b.version}#${b.hook}`),
  );
  fs.mkdir(path.slice(0, path.lastIndexOf("/")));
  fs.writeFile(path, `${JSON.stringify({ schema_version: 1, approvals }, null, 2)}\n`);
  return approvals;
}

export function describeMismatch(
  approvals: ScriptApproval[],
  request: ApprovalRequest,
): string | null {
  const sameHook = approvals.filter(
    (approval) => approval.package === request.package && approval.hook === request.hook,
  );
  if (!sameHook.length) return null;
  const sameVersion = sameHook.find((approval) => approval.version === request.version);
  if (!sameVersion) {
    const versions = sameHook.map((approval) => approval.version).join(", ");
    return `approved for ${versions}, not ${request.version}`;
  }
  if (sameVersion.integrity !== request.integrity)
    return "the tarball integrity changed since the approval";
  if (sameVersion.script_hash !== hashScript(request.script))
    return "the script body changed since the approval";
  return null;
}
