# Prompt A/B: Maka baseline vs opencode default

Date: 2026-06-24

## Status

The earlier pilot result is superseded. It used an RSI-style held-in/held-out acceptance policy and reported `discard`, which is not the right evaluator for a fixed A/B prompt comparison.

This PR now treats the run as a pure A/B evaluator:

- one `evaluationTasks` set, not held-in/held-out partitions;
- metadata prefilter keeps the primary short-horizon pool to tasks with `expert_time_estimate_min <= 30` by default;
- baseline A qualification is opt-in; the default primary run directly evaluates the metadata-filtered short pool;
- primary statistics are task-level deltas with an exact sign test, not independent attempt samples;
- result language is `B better`, `A better`, or `inconclusive`;
- budget exhaustion is reported separately from infrastructure failures.

## Formal Run Shape

- Metadata filter: reject tasks whose declared expert estimate is above `MAKA_PROMPT_AB_MAX_EXPERT_MIN` (default 30 minutes) before primary comparison.
- Qualification: skipped by default. Set `MAKA_PROMPT_AB_USE_QUALIFICATION=1` only for a separate baseline-medium slice.
- Primary A/B: all metadata-filtered short tasks by default; on the current local cache that is 34 tasks x 3 reps x 2 arms = 204 formal jobs.
- Execution: A/B arms run adjacent within each task-rep pair, with first arm alternated by deterministic task/rep parity.
- Decision: exact two-sided task-level sign test at `p <= 0.05`, with task-level mean delta agreeing with the winning direction.
- Default task budget: `MAKA_PROMPT_AB_TASK_BUDGET_SEC=1800`.
- Default Harbor watchdog: `MAKA_PROMPT_AB_HARBOR_TIMEOUT_MS=2100000`, leaving 5 minutes for Harbor/Docker cleanup after the 30-minute cell budget.

## Timeout Limitation

The primary comparison is intentionally time-bounded to tasks whose declared expert estimate is at most 30 minutes, and the default task budget matches that pool at 30 minutes. A 10-minute budget is useful only for smoke runs; it should not be used for the primary A/B result because it can hide prompt gains that need more exploration, verification, or repair time. The report must show per-arm timeout counts, and task-rep pair-level timeout asymmetry forces an `inconclusive` decision.

Tasks with 60+ minute expert estimates should not be mixed into this primary short-task A/B summary. Long-horizon sensitivity should be run separately on a smaller hard/near-timeout slice with an explicit longer budget and 1-2 reps.

## Artifacts

The runner writes local artifacts under `MAKA_PROMPT_AB_OUT_DIR/<runId>/`:

- `prompt-ab-result.json`
- `prompt-ab-report.md`
- controller WAL and per-round TSVs
- Harbor jobs, runtime events, and prompt copies

Raw WAL/job/runtime artifacts remain local and are intentionally not committed.
