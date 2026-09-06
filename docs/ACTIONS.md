# Scheduled scans

The original native cron expression is preserved. The gate permits automated scan starts Monday-Friday from 09:00 until 20:00 in `America/New_York`; attempts at or after 20:00 are skipped. The timezone accounts for daylight saving time. Manual **Run workflow** bypasses the window; automated dispatches do not.

## Investigation on September 6, 2026

The workflow on the default branch is active and matches the local cron. Recent scans are successful, with no evidence of timeouts or concurrency cancellations in the inspected runs. However, run creation is sparse:

| September 4 start (Eastern) | Scan result |
|---|---|
| 12:17 PM | Successful, about 9 minutes including setup and publication |
| 3:49 PM | Successful, about 8 minutes |
| 5:53 PM | Successful, about 9 minutes |
| 7:58 PM | Successful, about 8 minutes |
| September 5, 12:17 AM | Window check only; all scan steps skipped |

The last run's seven-second green result did not update the board. The guard correctly enforced the time limit, but the old workflow made a skipped scan look successful. The new workflow gives the scan its own job, which is visibly skipped, and writes an explicit decision summary.

Evidence: [run history](https://github.com/WonOfAKind/New-Grad-And-Internships-2027/actions/workflows/monitor.yml), [successful scan](https://github.com/WonOfAKind/New-Grad-And-Internships-2027/actions/runs/33931407986), [outside-window run](https://github.com/WonOfAKind/New-Grad-And-Internships-2027/actions/runs/33944163626).

The sparse event creation and outside-window arrival are consistent with GitHub schedule delays/drops, not a monitor runtime failure. The public API does not expose the intended fire time or the backend reason for a missing event, so it cannot establish the exact scheduler failure. [GitHub documents that scheduled events can be delayed or dropped](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). Increasing the cron frequency alone does not guarantee scans.

## Independent scheduler fallback

The workflow accepts an authenticated `repository_dispatch` event with type `role-monitor`. An external scheduler can call GitHub's repository dispatch endpoint with `{"event_type":"role-monitor"}` during the same window. Both triggers share the existing concurrency group; dispatches arriving outside the allowed hours are skipped. No external scheduler is provisioned by this repository change.

Configure an external scheduler if reliable cadence is required. Keep its GitHub credential in that service's secret store. Do not use manual `workflow_dispatch` for automated scheduling because manual runs intentionally bypass the time guard.

## Verification

`npm run validate` checks monitor syntax and regression cases, and exercises the actual workflow gate across summer/winter offsets, both window boundaries, weekends, late arrivals, and both dispatch types. Each monitor job reports whether scan/publication succeeded and the timestamp of its output. The board's last-updated timestamp remains the time of the last completed scan.
