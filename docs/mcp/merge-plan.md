# Merge plan into canonical repo

Canonical repository (not yet initialized at the time of this work):

```
/Users/admin/Projects/universal-ai-project-manager/
```

This workstream lives in an independent worktree at
`/Users/admin/Projects/uapm-cc/` on branch `feat/mcp-multiagent`.

## Owned paths

```
apps/mcp-server/
automation/n8n/
infra/mcp/
docs/mcp/
docs/automation/
```

None of these paths overlap with the backend (Codex) or Astra frontend
workspaces. There is no modification of `main`.

## Steps to merge once the canonical repo exists

```bash
# 1. In the canonical repo, create an orphan remote tracking this worktree
cd /Users/admin/Projects/universal-ai-project-manager
git remote add uapm-cc /Users/admin/Projects/uapm-cc
git fetch uapm-cc feat/mcp-multiagent

# 2. Review and open a PR
git checkout -b feat/mcp-multiagent uapm-cc/feat/mcp-multiagent
git push origin feat/mcp-multiagent
# then open PR into main
```

If the canonical repo already has an unrelated `apps/`, `automation/`,
`infra/` or `docs/` tree, resolve by moving these subtrees — never
overwrite in place. The paths above are self-contained.

## Backend contract dependency

The MCP server depends on `packages/contracts/openapi.yaml` once Codex
publishes it. Until then, `UAPM_BACKEND_MODE=mock` is used by default.
Switch to `UAPM_BACKEND_MODE=http` and set `UAPM_BACKEND_BASE_URL` once
the backend endpoint is live, then run the integration test again.
