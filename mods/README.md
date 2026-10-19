# Command Code mods registry

[`registry.json`](./registry.json) in this folder is the community registry behind the
[mods hub](https://commandcode.ai/mods). The hub reads it live, so a merged PR here lists
your mod within minutes — no website deploy.

Every listed mod has a reviewed entry in `registry.json`. Publish your mod to npm
or GitHub, then open a PR against this file. Publishing an npm package with the
`cmd-mod` keyword helps maintainers discover it for review; it does not list it
automatically. Existing GitHub entries continue to load from the file without
an npm review or a website deployment.

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
| `npm` | no | names its published npm package for live metadata and download counts |
| `tags` | no | lowercase slugs, searchable |
| `addedAt` | no | `YYYY-MM-DD`, used for the "Newest" sort |

`official`, `featured`, and the top-level `hidden` list are maintainer-only — leave them out of your PR.

Keep the array valid JSON (no trailing commas) and one mod per PR where you can, so review stays quick.

For an npm mod, set both `source` and `npm` to the full package name, including
its scope. Give scoped packages a separate unique lowercase `name` matching the
schema. The entry supplies the description, author, categories, and tags; npm
adds the latest version, publish date, and monthly downloads. A GitHub `repo`
adds its star count. Maintainers review the published package code before
listing it. Review is not a sandbox or a guarantee about future releases.
