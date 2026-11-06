# coder-fleet-roster

A Claude Code mod that keeps a **Roster** pane beside the chat with every subagent this session has started:
who is running, the tool each one is on right now, how long it has taken, and what it answered. It costs no
model tokens: the hooks run inside the app and the pane is drawn by the interface.

```
Roster   ● 2 running   ◐ 1 waiting   ✓ 3 done   show 3 finished   clear finished

● ▸ general-purpose  Implement the roster pane  opus-5-5 · 4m 12s · 31 tools
    › Bash Run the tests  12s
  └ ● ▸ Explore  Find the pane examples  haiku-5-5 · 48s · 9 tools
      › Grep "ui.render"  1s
◐ ▸ coder-fleet:reviewer @rev  Review the diff  sonnet-5-5 · 2m 03s · 14 tools · background
    waiting on background work or an approval
✓ ▸ Explore  Map the hooks  haiku-5-5 · 22s · 6 tools
    The hooks live in hooks/register.tsx and hooks/view.tsx
```

## Install

At the prompt of a terminal session:

```
/plugin install coder-fleet-roster --marketplace rzem-ai/coder-fleet-roster
```

Answer `y` to add the marketplace, then pick a scope (user is first). From a shell:

```bash
claude plugin install coder-fleet-roster --marketplace rzem-ai/coder-fleet-roster
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace
with `rzem-ai/coder-fleet-roster`, then Add plugin.

## What you get

- **A card per agent**: its status, type, `@name`, task description, model, elapsed time and tool count.
  Agents started by another agent nest under it.
- **What it is doing now**: the tool call in flight (`› Bash Run the tests`, `› Read auth.ts`) and how long it
  has been at it, or `thinking`, `waiting`, `idle` between calls. Once it ends, the first line of its answer.
- **Unfold a card** (`▸`) for its last eight calls with how each went, its whole answer, and **view transcript**,
  which puts that agent's transcript in the main view (**back to main** returns).
- **A status line** while anything is live: `roster · 2 running · 1 waiting`.
- **Toasts** when an agent finishes or fails.
- `f` shows or hides finished agents, `c` clears them, `m` goes back to the main transcript.

Status comes from the agents' own events (spawn, every tool call, each turn's start and end) and is checked
against the engine's agent list once a second while anything is live, so a teammate going idle, an agent
killed from the tasks list, or one started before the mod loaded all show up correctly.

## Commands

- `/roster`: open the pane.
- `/roster status`: the roster as text.
- `/roster clear`: drop finished agents.

## Settings

| Option     | Default | What it does                                                                           |
| ---------- | ------- | -------------------------------------------------------------------------------------- |
| `autoOpen` | `true`  | Open the pane when the first subagent starts. Closing it by hand stops that for the session. |
| `toasts`   | `all`   | `all` (done and failed), `failures`, or `off`.                                          |

## Developing

```bash
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
