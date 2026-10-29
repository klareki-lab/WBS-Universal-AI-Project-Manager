# G3 baseline and failure record

The integration worktree was created from remote main after fetching and matching all three frozen SHAs. The three source histories were merged without file conflicts; application behavior required the contract corrections in COMPATIBILITY.md. Existing component/agent worktrees and services were preserved.

Clean npm installs succeeded using the committed lockfiles in all three packages. Before integration fixes, backend and frontend typechecks/builds succeeded; the frontend's 28 tests and MCP's 21 non-live tests passed. These baseline component results did not validate a functioning full system. Backend OpenAPI generation reports 28 paths, 43 schemas (33 operations). No package has a lint script: TypeScript, build, backend Prettier and contract checks are the applicable static checks.

Observed failures, retained in the ignored local diagnostic files and summarized here:

- Original n8n graphs imported but could not execute: empty subworkflow input schemas, unresolved AI credential nodes, incomplete routing and a nonexistent MCP call-tool endpoint. The fixture compiler, passthrough inputs, routing and authenticated SDK facade resolve the deterministic path. AI graphs remain unverified.
- Actual MCP bodyless POSTs returned Fastify's empty-JSON-body error because the adapter always set JSON Content-Type. Headers now match the body.
- Publication committed in PostgreSQL but the MCP output failed validation: canonical task_ids is a key-to-ID map, whereas the adapter declared an array. Conversion and original-key replay now pass real executor tests.
- MCP dashboard reported zero tasks despite persisted rows because it read an obsolete count field. The adapter now reads by_status. The real workflow test asserts the persisted task count.
- Repeated parallel acceptance attempts exhausted the unchanged 120/minute backend request budget. Runs are sequential and use fresh synthetic identities; the main browser test allows a fresh window before the second browser. No rate limit was weakened.
- First outage UI probe reached the login gate without displaying the server error. SessionGate now shows non-401 bootstrap errors and recovers after a real G3 database restart.
- Initial helper assumptions about requestApproval sequencing were corrected after inspecting the canonical handler: requestApproval can move draft→in_review itself; the explicit submitReview→requestApproval sequence is also supported and tested.
- Synthetic token bootstrap initially used the wrong bearer encoding. Bootstrap now uses 32-byte base64url tokens; no real credential was used or disclosed.
- Zod 3.x in the frozen MCP package had a high advisory in npm audit. The package and lockfile now use patched Zod 4.6.7, with explicit sparse enum dictionary validation. Final package audits show zero findings.
- New automation provisioning rollback tests initially expected an unsanitized 503 error code. Assertions were corrected to the backend's existing sanitized internal_error contract; the policy and error handler were unchanged.

Failed attempts are excluded from final passing totals. The final evidence files are fresh successful runs; this record preserves the material failures rather than erasing their existence. Full original diagnostics remain local under ignored .g3 and /tmp/uapm-g3-* files; they are not published because raw runtime data can contain authentication headers.
