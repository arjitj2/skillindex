# Plugin Update Card Polish Design

## Context

Healthy skills, subagents, and MCPs can show a non-blocking `Plugin Update Available` advisory. The current candidate presentation is a loose stack of an evidence label, a cache path, and a text action. Those elements use several unrelated typographic treatments and do not read as one actionable object.

## Scope

Polish only the candidate presentation inside the existing plugin-update advisory. Keep the advisory's placement, title, behavior, action semantics, and non-blocking status unchanged.

## Design

Render every plugin update candidate as a compact version card that reuses the detail pane's established variant-card language:

- Contain the evidence, path, dependency warnings, and action inside one bordered card.
- Present the evidence label as a neutral badge rather than a standalone heading.
- Present the candidate path once in muted monospace, with existing Sandbox-aware path formatting and truncation.
- Present `Update Universal` as a real secondary button, not an inline text link.
- Stack multiple candidates as visually identical cards.
- Keep dependency warnings inside the same card beneath the path so they remain associated with the candidate.
- Use existing detail-pane color, spacing, typography, radius, focus, disabled, and pending-state conventions. Do not introduce new global tokens or a one-off visual language.

The card has three hierarchy levels only: the advisory section label, the evidence/path content, and the action.

## Interaction and accessibility

- Each candidate retains its existing explicit update action and exact source path.
- The button keeps a distinct accessible name containing the evidence and full display path.
- Pending state disables the button and changes its label to `Applying...`.
- Keyboard focus must be visible on the candidate action.
- Long paths and warnings wrap without overflowing the detail pane.

## Testing

- Update focused `DetailInspectorPanel` tests for the cohesive candidate card and distinct candidate actions.
- Run `pnpm typecheck` and focused renderer Vitest coverage.
- Start Electron against a fresh representative Sandbox, promote a plugin version, and inspect the healthy update advisory.
- Verify normal, hover/focus, and pending/disabled presentation where practical.
- Capture and attach a fresh screenshot of the final rendered card.

## Non-goals

- Moving the advisory to another tab or changing its priority.
- Changing plugin version evidence or update-selection rules.
- Changing update, Undo, cache, or filesystem behavior.
- Redesigning unrelated detail-pane sections.
