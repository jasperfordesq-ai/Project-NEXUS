# Minimal Platform Monorepo Checklist

- [x] Isolated worktree created at `C:\platforms\htdocs\nexus-platform-consolidation`.
- [x] Branch created: `codex/platform-monorepo`.
- [ ] Source SHAs and allowlist recorded.
- [ ] ASP.NET tracked snapshot imported to `aspnet-backend/`.
- [ ] Web UK tracked snapshot imported to `web-uk/`.
- [ ] Generated files, caches, local environments, and old changelog excluded.
- [ ] Relative contract tooling added.
- [ ] Separate non-deploying contract CI added.
- [ ] Docker build context exclusions added.
- [ ] ASP.NET build/tests pass.
- [ ] Web UK lint/build/tests pass.
- [ ] Contract comparisons pass or remaining pre-existing gaps are reported.
- [ ] Laravel deployment scope remains unchanged.
- [ ] Security and staged-file review passes.
- [ ] Branch handed off without push, merge, version bump, or deployment.
