# Community mods

Ten small, dependency-free mods for Command Code 1.81.0 or newer. The repository manifest loads the TypeScript sources directly; no build or npm publishing is needed to install.

```sh
cmd mods add CommandCodeAI/command-code -g
cmd mods list
```

**This installs all ten mods as one bundle.** Each catalog entry uses that same install command. Disable any individual mod by its name, then restart Command Code (or use `/reload`):

```sh
cmd mods disable cmd-mod-context-meter -g
cmd mods enable cmd-mod-context-meter -g
```

| Mod | Commands | What it does |
| --- | --- | --- |
| `cmd-mod-review` | `/review-changes [base-ref]` | Supplies real Git context for a code review with severity, locations, and failure scenarios. |
| `cmd-mod-standup` | `/standup [YYYY-MM-DD]` | Drafts an update from up to 50 recent commits and working changes. Defaults to the past 24 hours. |
| `cmd-mod-pr-draft` | `/pr-draft [base-ref]` | Drafts a PR title/body with verified changes and honest testing status. |
| `cmd-mod-release-notes` | `/release-notes [base-ref]` | Drafts user-facing notes and distinguishes uncommitted changes. |
| `cmd-mod-test-plan` | `/test-plan [base-ref]` | Plans concrete regression cases, expected outcomes, and relevant test commands. |
| `cmd-mod-git-summary` | `/git-summary [base-ref]` | Reports status, commit/staged/unstaged stats, and recent commits without a model call. |
| `cmd-mod-context-meter` | `/context-meter` | Shows measured context usage in a supported footer; suggests `/compact` at 80%. Never compacts automatically. |
| `cmd-mod-run-stats` | `/run-stats` | Reports timing and successful/failed tool counts for the current or latest run. Resets on a new session. |
| `cmd-mod-bookmarks` | `/bookmark <label>`, `/bookmarks`, `/jump-bookmark <label-or-id>` | Labels a session point and navigates back to it. Duplicate labels require an exact ID. Navigation changes the conversation branch; it does not revert filesystem changes. |
| `cmd-mod-focus` | `/focus <goal>`, `/focus status`, `/focus off` | Persists a scoped reminder in the session and restores it on resume. Later explicit instructions take priority. |

Git base defaults to the first available `origin/main`, `main`, `origin/master`, `master`, or `HEAD`. Specify a tag/commit/branch for release notes or an already-merged PR; a default of `HEAD` includes only working changes. Committed stats compare the merge base to HEAD. Git snapshots include filenames, commit subjects, and change counts; the agent inspects actual content for review and drafting. Each command output is capped at 6,000 characters and marked when truncated. Untracked contents are not included. `/standup` considers all local branches, so review attribution before sharing an update.

The first five commands submit a model turn. Git summary and session utilities do not. Draft commands do not publish, push, or send updates. A focus reminder guides the agent; it is not an enforcement boundary. Focus persists only when durable sessions are available. Bookmarks require a recorded session point. Run counts exclude denied/blocked tools and count completed/errored tool events across the current run.

## Develop and verify

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

To test the bundle before merging, install a local checkout:

```sh
cmd mods add ./path/to/command-code
```

Or load a single mod without installing:

```sh
cmd --mod ./mods/community/cmd-mod-git-summary.ts
```

`api.ts` is a structural, type-only subset of the host API; it ships no private package or runtime dependency. The Command Code source repo also verifies all factories against the real ModApi and loads this manifest through the real jiti loader. Built ESM files in `dist/` are optional and are not tracked. The tests cover command errors and reference validation, output limits, headless context usage, run lifecycle, session labels, and focus resume/reset behavior.
