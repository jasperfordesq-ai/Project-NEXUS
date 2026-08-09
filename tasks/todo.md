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
- [ ] ASP.NET build/tests pass.
- [ ] Web UK lint/build/tests pass.
- [ ] Contract comparisons pass or remaining pre-existing gaps are reported.
- [ ] Laravel deployment scope remains unchanged.
- [ ] Security and staged-file review passes.
- [ ] Branch handed off without push, merge, version bump, or deployment.
