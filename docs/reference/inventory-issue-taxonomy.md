# Inventory Issue Taxonomy

Canonical status labels for Skill Index inventory records.

Use this document as the source of truth for issue naming in code, UI copy, tests, and future agent work.

## Skills

Canonical assumption:
- Canonical skills live in `~/.agents`

Happy state:
- `Healthy`

Issues:
- Defined in canonical but not yet symlinked elsewhere:
  `Missing Symlinks`
- Defined in any or multiple non-canonical locations but not in canonical:
  `Missing Canonical`
- Defined in both canonical and non-canonical as a copy, not a symlink:
  `Identical Copies`
- Defined in both canonical and non-canonical, and non-canonical has drifted:
  `Diverged Copies`
- Skill path exists as a symlink, but the symlink is broken:
  `Broken Symlink`
- Skill path exists as a symlink, but it points somewhere other than canonical:
  `Wrong Symlink Target`
- Skill definition is invalid or incomplete:
  `Invalid Definition`

Notes:
- Use `Identical Copies` for the copy-not-link case when contents still match.

## MCPs

Happy state:
- `Healthy`

Issues:
- Definition differs across agents:
  `Definition Mismatch`
- Defined in one or more agents but missing from others:
  `Missing From Agents`
- Definition is invalid in one or more agents:
  `Invalid Definition`
- Definition is valid, but the configured server could not be reached or verified:
  `Connection Failed`
