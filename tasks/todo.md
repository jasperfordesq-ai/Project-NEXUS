# Minimal Platform Monorepo Checklist

- [x] Isolated worktree created at `C:\platforms\htdocs\nexus-platform-consolidation`.
- [x] Branch created: `codex/platform-monorepo`.
- [x] Source SHA and allowlist recorded.
- [x] ASP.NET tracked snapshot imported to `aspnet-backend/`.
- [x] Web UK tracked snapshot imported to `web-uk/`.
- [x] Generated files, caches, local environments, and old changelog excluded.
- [x] Relative contract tooling added.
- [x] Separate non-deploying contract CI added.
- [x] Docker build context exclusions added.
- [x] ASP.NET build passes; the full API suite remains delegated to the
      90-minute CI job after exceeding the local ten-minute ceiling.
- [x] Web UK lint/build/tests pass (55 suites, 1,756 tests).
- [x] Contract comparisons pass and remaining pre-existing gaps are reported.
- [x] Laravel deployment scope remains unchanged.
- [x] Security and staged-file review passes.
- [x] Branch handed off without push, merge, version bump, or deployment.
