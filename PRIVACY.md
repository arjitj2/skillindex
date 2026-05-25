# Privacy

Effective date: May 24, 2026

Skill Index is built to run locally on your Mac. The app does not require an
account, does not sync your data to a cloud service, and does not send telemetry.

## What the App Reads

Skill Index scans local agent-related folders and configuration files so it can
show you where skills, MCP servers, plugins, and related capabilities are
installed. Depending on your agent setup, those files may include secrets,
tokens, local paths, or other sensitive configuration values. Skill Index reads
that information locally to build its inventory and compare definitions.

This may include paths such as:

- `~/.skillindex/`
- `~/.agents/skills/`
- `~/.codex/`
- `~/.claude/`
- Other custom folders you choose in the app

## What the App Writes

Skill Index stores its own local state under `~/.skillindex/` by default,
including settings, inventory cache data, and a local audit log of file-changing
operations. When you choose repair or standardization actions, the app may also
write to the local agent configuration or skill directories involved in that
action.

## What Leaves Your Machine

The Skill Index desktop app does not send personal information, telemetry,
analytics, crash reports, usage events, local paths, or configuration contents to
the project maintainers.

## Network Access

Skill Index may access the network for specific product features, but this is
not telemetry. Packaged standard builds check GitHub Releases for updates. Skill
Index may also connect to remote MCP servers you have configured, install skills
from URLs or repositories when you choose that action, load remote agent icon
images, or open external links in your browser. Network access is not used to
collect your local inventory, paths, skill contents, MCP configuration contents,
secrets, tokens, or audit log.

If you visit `skillindex.app`, GitHub, or other linked services, those services
may process standard server logs or other information under their own privacy
policies. If you contact the project maintainers directly, we will use the
information you provide only to respond to your message or handle the related
project issue.

## Policy Updates

If Skill Index's privacy practices change, we will update this file to describe
the new practices. This includes changes such as adding accounts, cloud sync,
telemetry, crash reporting, hosted services, or other data collection.
