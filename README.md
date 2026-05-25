# Skill Index

[![CI](https://github.com/arjitj2/skillindex/actions/workflows/ci.yml/badge.svg)](https://github.com/arjitj2/skillindex/actions/workflows/ci.yml)
[![CodeQL](https://github.com/arjitj2/skillindex/actions/workflows/codeql.yml/badge.svg)](https://github.com/arjitj2/skillindex/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/arjitj2/skillindex/badge)](https://scorecard.dev/viewer/?uri=github.com/arjitj2/skillindex)

https://github.com/user-attachments/assets/f852192a-352d-4087-bab4-c0aac400ca35

Organize and standardize your knowledge across agents, 100% locally.

Skill Index is a local macOS app to standardize the skills, MCP servers, and plugin capabilities you use across AI agents. Each of your 40+ agents should be able to draw from the same body of knowledge instead of slowly drifting into separate setups.

Download it at [skillindex.app](https://skillindex.app).

## Why

Agents should share your knowledge.

If you teach one agent a skill, install one MCP server, or standardize one capability, you should be able to move between agents without rebuilding the same setup over and over. Skill Index is built around a simple opinion: your agent knowledge should be portable, inspectable, and shared by default.

For skills, Skill Index treats `~/.agents/skills` as the canonical user-owned location and helps compatible agents point back to it. For MCPs, the goal is not to declare one folder universal; it is to compare the definitions each agent sees, surface mismatches, and help you make the same services available consistently.

Agent-native folders such as `~/.codex/skills`, `~/.claude/skills`, `~/.cursor/skills`, and plugin caches are still important. They just should not silently fork what you know. Skill Index also supports alternate canonical paths for people who maintain their own skills repos: add a custom path in Settings, then mark it as the preferred canonical source.

That is the opinionated stance: organize your knowledge once, make it visible everywhere you work with agents.

## What It Does

Skill Index gives you a local control plane for agent knowledge:

| Step | What happens |
| --- | --- |
| **Map** | Scan user-level skill directories, MCP configs, and installed plugin capabilities. |
| **Compare** | See which skills are canonical, copied, symlinked, missing, invalid, or drifting apart. See when MCP definitions differ across agents. |
| **Standardize** | Review safe auto-fixes from the dashboard, apply them in a batch, or choose explicit repair actions for individual skills and MCPs. |
| **Audit** | Review a local audit log of file-changing operations so every mutation is accountable. |

Plugin-provided skills and MCPs are shown as managed, read-only capabilities. They are part of the knowledge map, but Skill Index does not pretend it owns them.

## Local By Default

Skill Index runs on your machine and works with files on disk.

App state lives under `~/.skillindex/` by default:

```text
~/.skillindex/
  config.json       settings such as custom scan paths and the preferred canonical source
  cache.json        latest inventory cache
  audit-log.jsonl   file-changing operations
  sandbox/          representative dev fixtures
```

The production app scans known local agent locations and custom paths you add.

## Install

Skill Index ships as a universal macOS app for Apple Silicon and Intel Macs.

Download the latest public Mac build from [skillindex.app](https://skillindex.app).

Windows and Linux support are planned, but the current release path is macOS.

## Use It

1. Open Skill Index.
2. Review the dashboard for skills or MCPs that need attention.
3. Use **Auto-resolve easy issues** to review safe repairs and apply them together.
4. Open a skill, MCP, plugin, or agent detail view when you want to inspect source paths, definitions, or a single repair.
5. Check the Audit view when you want to confirm what changed.

## Supported Today

Skill Index currently focuses on user-home agent setup: skills in agent-specific folders and the universal `~/.agents/skills` location; MCP configs across JSON, JSONC, TOML, YAML-style agent config shapes, and plugin bundles; Codex and Claude plugin caches; and a known agent catalog with verified overrides where upstream metadata is stale or incomplete.

Project-level agent configuration is intentionally on the roadmap, not silently half-supported.

## Roadmap

- [ ] Automatic background resolution for straightforward issues.
- [ ] First-run onboarding for alternate canonical skill sources, including repo-backed skill folders.
- [ ] Project-level agent configuration, not just user-home configuration.
- [ ] Custom instruction files such as `AGENTS.md`, `CLAUDE.md`, and related agent docs.
- [ ] Subagent support, such as `.claude/agents`, `.codex/agents`, `.gemini/agents`, and `.qwen/agents`.
- [ ] Commands support, such as `.claude/commands`, `.gemini/commands`, and `.qwen/commands`.
- [ ] Hooks support, such as `~/.claude/settings.json`, `~/.codex/hooks.json`, `~/.codex/config.toml`, `~/.gemini/settings.json`, and `~/.qwen/settings.json`.
- [ ] Broader packaged support for Windows and Linux.

## Develop

Requirements:

- Node `^20.19.0 || ^22.13.0 || >=24`
- pnpm `>=10`
- macOS for the desktop app and packaged builds

Run the app:

```bash
pnpm install
pnpm dev
```

Renderer dev server ports start at `5600` and automatically increment when occupied.

Run checks:

```bash
pnpm test -- --maxWorkers=4
pnpm typecheck
pnpm lint
pnpm build
```

Create a local unsigned production-shaped Mac build:

```bash
pnpm dist:mac:unsigned
```

Create an unsigned dev-alpha zip for friendly testing:

```bash
pnpm dist:dev
```

Dev-alpha builds start in the representative sandbox and keep the Sandbox/Live source switcher available in the sidebar. Use that switcher to move between bundled fixtures and your real machine while testing.

Production releases are built by GitHub Actions from version tags and publish signed, notarized universal macOS DMGs plus updater metadata to GitHub Releases. See [docs/release.md](docs/release.md).

## Contribute

The most useful contributions keep agent metadata accurate as agent tools change where they read skills, config files, MCP definitions, plugins, and install markers.

Before opening a PR, read [CONTRIBUTING.md](CONTRIBUTING.md). For source layout, see [src/README.md](src/README.md).

Reference docs:

- [Agent catalog file hierarchy](docs/reference/agent-catalog-file-hierarchy.md)
- [Upstream agent catalog refresh guide](docs/reference/upstream-agent-catalog-refresh-guide.md)
- [Inventory issue taxonomy](docs/reference/inventory-issue-taxonomy.md)

Security issues should be reported through GitHub Security Advisories, not public issues. See [SECURITY.md](SECURITY.md).

Skill Index is local-first and does not use accounts, cloud sync, or telemetry. See [PRIVACY.md](PRIVACY.md).
