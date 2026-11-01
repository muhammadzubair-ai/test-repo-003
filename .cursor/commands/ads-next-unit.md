# Run Agentic Delivery Studio units

Build the units the selector names, one after another, then stop. Each unit gets its own claim, branch, PR and report.

The selector is the text that follows the command (for example `/ads-next-unit U-3, U-7` or `/ads-next-unit up to U-30`). If nothing follows, take the next free unit only.

## Which units

The selector is whatever follows the command. Read it with these rules; numbers are the unit IDs (`U-12` is 12), not positions in a list.

| Selector | Meaning |
| --- | --- |
| *(empty)* | the next free unit only |
| `U-12` | that unit only |
| `U-3, U-7, U-9` | those units (commas, spaces or both) |
| `U-5 to end`, `U-5..`, `from U-5` | every unit numbered 5 or higher |
| `up to U-30`, `upto U-30`, `..U-30` | every unit numbered 30 or lower |
| `U-5..U-9`, `U-5 to U-9` | every unit from 5 to 9 |
| `all` | every unit |
| `feature N-3`, `feature N-3, N-5` | every unit whose `feature` is that ID (`N-3` is a feature, not a unit), in `sequence` order; combine with a unit form to narrow it, for example `feature N-3 up to U-30` |

A feature selector asks `list_tasks` with that `featureId`. If it returns nothing, say the feature has no units available and stop. Forms combine, for example `U-1..U-4, U-9, U-20 to end`. Ranges and `all` cover only units `list_tasks` returns, so a gap in the numbers is fine. An ID you named that `list_tasks` does not return is reported as not available. If you cannot read the selector, ask the user to restate it; do not guess.

## Setup (once)

1. Call `get_execution_guide` with `target: "cursor"` and follow it for everything below.
2. Call `list_tasks` and resolve the selector against it. Order the result by `sequence`. If it is empty, stop and say so. Tell the user the resolved list (for example "U-5, U-6, U-9: 3 units") before you start.

## For each unit, in order

3. Call `list_tasks` again. If the unit is gone, claimed by someone else or still blocked (`blockedBy` not empty), skip it and note why. Do not wait for it.
4. Call `claim_task` for it. Keep the `attemptId` and the `baseBranch`; call `heartbeat` at least every 2 hours while you work.
5. Call `get_task` with `target: "cursor"`. Its prompt is the specification: scope, acceptance criteria, guardrails and the exact branch and PR title. Use `get_reference` for the full text behind a reference.
6. Start from a clean `baseBranch`, never from the previous unit's branch: run `git status` (the tree must be clean), `git fetch origin`, `git checkout <baseBranch>`, `git pull --ff-only origin <baseBranch>`, then `git checkout -b <the unit's branch>`. If `baseBranch` is a feature branch that does not exist yet, create it from the default branch and push it first. Confirm with `git branch --show-current`. Then build only what the unit's scope covers, with tests.
7. Before you commit, run `git status`: never commit `.env.ads` or `.cursor/mcp.json`, which hold the executor token.
8. Self-review the diff against each acceptance criterion and guardrail, then open one PR into `baseBranch`.
9. Call `report_result` with the outcome, a summary, pass or fail for each criterion and for `self-review`, the branch and the PR URL. If the report is rejected, fix what it says and report again.
10. Once the PR is open and reported, run `git checkout <baseBranch>` so the checkout is not left on the unit's branch, with a clean tree, then take the next unit. Do not carry one unit's code into the next branch. This applies after the last unit too.

## When a unit does not finish

A unit that fails, needs analysis or is already satisfied does not stop the run. Report it as step 9 says, then continue. Skip any later unit whose `blockedBy` still lists it. A unit blocked only by a unit from this run whose PR is not merged yet is skipped too: say it is waiting on that PR. Stop the whole run only if the MCP server is unreachable or the token is rejected.

If a unit is unclear, too large or already done, do not guess: use `ask_question`, or report `needs_analysis` or `already_satisfied`.

## At the end

Finish with one line per selected unit: the unit, then `PR <url> (<outcome>)` or `skipped: <reason>`. Nothing more.

Installed by `ads connect`; running it again refreshes this file.
