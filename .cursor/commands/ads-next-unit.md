# Run the next Agentic Delivery Studio unit

Build exactly one unit from the project this repo is connected to, then stop.

If a unit ID follows the command (for example `/ads-next-unit U-12`), work on that unit; otherwise take the next free one.

1. Call `get_execution_guide` with `target: "cursor"` and follow it for everything below.
2. Call `list_tasks`. Take the requested unit, or else the first unit whose `blockedBy` is empty. If none is free, stop and say which units are blocked and by what.
3. Call `claim_task` for it. Keep the `attemptId` and the `baseBranch`; call `heartbeat` at least every 2 hours while you work.
4. Call `get_task` with `target: "cursor"`. Its prompt is the specification: scope, acceptance criteria, guardrails and the exact branch and PR title. Use `get_reference` for the full text behind a reference.
5. Build only what the unit's scope covers, with tests, on its branch from `baseBranch`.
6. Before you commit, run `git status`: never commit `.env.ads` or `.cursor/mcp.json`, which hold the executor token.
7. Self-review the diff against each acceptance criterion and guardrail, then open one PR into `baseBranch`.
8. Call `report_result` with the outcome, a summary, pass or fail for each criterion and for `self-review`, the branch and the PR URL. If the report is rejected, fix what it says and report again.
9. End with three lines: the unit, the PR URL, and the outcome.

If the unit is unclear, too large or already done, do not guess: use `ask_question`, or report `needs_analysis` or `already_satisfied`.

Installed by `ads connect`; running it again refreshes this file.
