# Automatic Pinterest publisher

The Windows task runs every five minutes without Next.js or `npm run dev`. It loads the existing server modules through Vite SSR in middleware mode; it opens no HTTP port. Node 24 and the installed project dependencies are required. `.env` is loaded first and `.env.local` overrides it. Both the configured Pinterest environment and saved connection must be `production`.

Run a read-only database preview from the project directory:

```powershell
node --env-file=.env --env-file-if-exists=.env.local scripts/pinterest-publisher.cjs --dry-run
```

Dry runs do not refresh tokens, query Pinterest/Etsy, change statuses or publish. They write a local run summary under `.tmp/pinterest-publisher/`. An actual run uses `--run`; it publishes only Pins whose saved status is `SCHEDULED` and whose scheduled time has arrived.

Review the proposed Windows task before installation:

```powershell
powershell -NoProfile -File scripts/install-pinterest-publisher.ps1
```

The installer defaults to midnight tomorrow and repeats every five minutes for ten years. Add `-StartAt '2026-11-18 08:55'` to choose another future start. After review, add `-Install` to register it. No task is installed by previewing the command.

The default principal is the current user with `S4U`, without a stored password. Check the previewed identity; `-UserId 'COMPUTER\user'` can select the intended account explicitly. Verify the task under that identity before relying on it: S4U restrictions can affect network resources or encrypted user files. If that identity cannot access the database, AWS profile or credentials, reinstall using `-LogonType Interactive`; the user must then stay signed in. In either mode the PC must be on, connected and able to wake. `WakeToRun` and `StartWhenAvailable` are enabled, and overlapping task instances are ignored. The PowerShell and Node processes run hidden.

## Runtime rules

- At most five due attempts per run. Each board's Europe/London daily limit follows its highest active campaign rate, from one to four Pins/day; separate campaigns are not added together. Pins without a campaign default to two/day. The launch campaigns use two/day. Seven boards due at 09:00 are handled over the 09:00 and 09:05 runs.
- Future schedules are untouched. Pins that missed a previous calendar day are paused for review instead of being published in a backlog burst.
- One OS-temp lock per database coordinates the queue API and standalone workers on this machine. Atomic per-Pin claims provide another duplicate guard. A dead process's lock is reclaimed; a live owner is never displaced.
- Every due Pin's own Etsy destination must still be active according to a bounded live Etsy GET. Inactive or deleted products fail for review; unavailable Etsy/auth/network services defer the Pin without publishing.
- Invalid copy is marked failed so it cannot repeatedly occupy the front of the queue. Publishing uses the exact saved description and creative; it never invokes Bedrock or rewrites copy.
- Definitive rate-limit rejections can retry once. A failed or interrupted Pin creation is never blindly posted again. An uncertain result is paused for checking on Pinterest; interrupted `PUBLISHING` rows are flagged after 30 minutes.

Use the app to review failed or paused Pins before rescheduling. Check Pinterest first for any message beginning “Publication outcome uncertain”; a Pin may already exist. Do not simply reset it to scheduled.

The latest summary is `.tmp/pinterest-publisher/last-run.json`; cumulative summaries are `history.jsonl`. Task stdout/stderr logs are under `logs/`. Summaries contain counts and local Pin IDs, not tokens, product copy or private creative paths. Check `Get-ScheduledTaskInfo -TaskName 'Etsy Pinterest Publisher'` for the last exit status. A non-zero process exit means configuration/runtime setup failed; individual Pin outcomes are recorded in the app and run summary.

## Installed catalogue launch

The task was installed on 16 November 2026 for Dave's Windows account using **Interactive** logon. Windows denied S4U registration; the Interactive task passed real database, production Pinterest, live Etsy and private S3 image checks, then completed a publisher run with exit code 0 and no early posts. Keep this PC on, online and signed in; the Windows session can be locked. Next.js does not need to be running.

The launch schedules 570 Pins for all 555 active Etsy products across seven public boards, starting **17 November 2026 at 09:00 Europe/London**. Each board has two daily slots, 09:00 and 13:00; the five-minute worker can spread simultaneous board publications over adjacent runs. The final scheduled Pin is on 14 January 2027. The 192 local artworks without an active linked Etsy product remain unscheduled.

The complete plan, copy, schedule, review and verification reports are in `output/pinterest/2026-11-launch/`. Original artwork and existing Pin media are preserved; 418 new dedicated creatives are stored privately. The existing 45 reviewed descriptions remain intact, while 107 old fixed-template descriptions were regenerated with Bedrock. No Pin was posted during setup.

## Production board correction, 17 November 2026

The first five due Pins were rejected because their legacy boards were sandbox entities. Reading a board through the production API and seeing `PUBLIC` did not establish that it accepted production Pins. Five fresh production boards were created with distinct topic names, and the existing local board rows were repointed without changing Pin IDs, campaigns, saved copy, images or scheduled times. The five definite rejections were retried successfully. The Sea Creature and Scarecrow boards had already published successfully, bringing the first slot to seven published Pins.

The account-scoped `.pinterest-board-environments.json` registry blocks these known legacy sandbox IDs before publication and filters them out of production board sync. The file reloads on each operation; retain it with this installation's configuration backups. An invalid or unreadable registry blocks board operations. The original sandbox boards were preserved. The replacement journal and first published Pin IDs are recorded in `output/pinterest/2026-11-launch/production-board-repair.json` and `publication-started.json`.
