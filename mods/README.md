# Command Code mods registry

[`registry.json`](./registry.json) in this folder is the community registry behind the
[mods hub](https://commandcode.ai/mods). The hub reads it live, so a merged PR here lists
your mod within minutes — no website deploy.

Two ways a mod gets listed:

1. **Publish to npm with the `cmd-mod` keyword** — it is discovered automatically, no PR needed.
2. **Open a PR against `registry.json`** — for git-only mods, or to add richer metadata. This is that path.

## Add your mod

Append one entry to the `mods` array in [`registry.json`](./registry.json). Editors validate it
against [`registry.schema.json`](./registry.schema.json).

```json
{
  "name": "cmd-mod-standup",
  "source": "owner/cmd-mod-standup",
  "description": "Adds a /standup command that summarizes what changed in git today.",
  "author": { "name": "Jane Dev", "github": "janedev" },
  "repo": "https://github.com/owner/cmd-mod-standup",
  "npm": "cmd-mod-standup",
  "kinds": ["command"],
  "tags": ["git", "productivity"]
}
```

### Fields

| Field | Required | Notes |
|-------|:---:|-------|
| `name` | yes | unique, lowercase `[a-z0-9._-]` — the hub's identity for the row |
| `source` | yes | what `cmd mods add <source> -g` installs: an npm name, `owner/repo`, or a `git:` URL |
| `description` | yes | 1–240 chars; the card summary |
| `author` | yes | `{ "name": "…" }` required; optional `github` / `url` link the name |
| `kinds` | yes | one or more of `tool` `command` `hook` `provider` `renderer` `flag` |
| `repo` | no | a GitHub URL also enables the star count |
| `npm` | no | links the entry to its npm package for live download counts |
| `tags` | no | lowercase slugs, searchable |
| `addedAt` | no | `YYYY-MM-DD`, used for the "Newest" sort |

`official` and the top-level `hidden` list are maintainer-only — leave them out of your PR.

Keep the array valid JSON (no trailing commas) and one mod per PR where you can, so review stays quick.

## Included community mods

[Ten useful mods](./community/README.md) live in this repository. Install the bundle once with `cmd mods add CommandCodeAI/command-code -g`, then enable or disable its individual mods by name. The ten catalog rows share this source; they are not separate npm packages.
