# RFC-004: Desktop BYOK Provider Parity — port `/connect` to the Desktop app

**Status**: Draft
**Author**: Community (via @midknight770)
**Created**: 2026-10-17
**Related Issues**: #1041 · [CommandCodeAI/desktop#72](https://github.com/CommandCodeAI/desktop/issues/72) · [CommandCodeAI/desktop#121](https://github.com/CommandCodeAI/desktop/issues/121)

## Summary

Bring the CLI's BYOK (bring-your-own-key) provider flow — the `/connect` wizard and the `providers.json` / `auth.json` key store it manages — to the Command Code Desktop app. Today a desktop-only user cannot add their own API key (DeepSeek, OpenRouter, Ollama, vLLM, …) without opening a terminal, even though the CLI that ships *inside* the same desktop bundle has the complete flow.

Three phases, cheapest first:

1. **Read parity** — BYOK providers from `~/.commandcode/providers.json` appear in the desktop model picker.
2. **Write parity** — an "Add a provider" flow in Settings that writes the same stores the CLI uses.
3. **Command parity** — `/connect` in the desktop command palette opens that flow.

## Motivation

### The gap, as shipped today (Desktop v0.1.55, bundled CLI 1.82.3)

- **The desktop model picker is a static catalog.** `fetchModels()` in the desktop main process returns `Object.values(MODEL_OPTIONS)` and never calls the harness's `loadProvidersConfig()` — even though that function is bundled inside the same app and is used for session routing. No BYOK provider can appear in the picker, regardless of how valid the config is. (Independently root-caused in [desktop#72](https://github.com/CommandCodeAI/desktop/issues/72).)
- **`/connect` does not exist in the desktop UI.** The renderer's hardcoded slash-command list includes `mcp`, `model`, `compact`, `agents`, `skills`, … but no provider-connect entry. The string `"Connect to AI providers"` (the CLI's `/connect` menu description) appears in the bundled CLI/harness on disk but nowhere in the desktop renderer bundles.
- **The desktop's own error copy instructs a command it doesn't have.** From the renderer's error catalog:

  > "Your Anthropic sign-in is no longer valid. In the Command Code CLI, run /login anthropic to sign in again **or /connect to switch providers**, then restart the desktop app."

  A desktop-only user who follows this finds nothing.

- **The desktop auth screen only supports Command Code account sign-in / Command Code API key.** There is no surface anywhere in the desktop UI to paste a third-party provider key.

### Why it matters

- A user whose Command Code credits are exhausted, but who holds their own provider key, is **stuck in the desktop app** — the exact workflow BYOK exists for.
- The stores are already shared (`~/.commandcode/providers.json`, `~/.commandcode/auth.json`); only the desktop's read and write surfaces are missing. This is parity work, not new infrastructure.
- The CLI bundled inside the desktop app already contains the entire flow: 150+ prefilled providers (from the same models.dev registry the CLI wizard uses), key storage in `auth.json` (mode `0600`), silent model discovery. The desktop can reuse the same harness functions.

## Design

### Data flow (target state)

```
┌──────────────────────────── Desktop App ────────────────────────────┐
│                                                                      │
│  ┌──────────────┐   IPC    ┌──────────────────────────────────────┐  │
│  │   Renderer   │ ───────► │             Main process            │  │
│  │              │          │                                      │  │
│  │  Model       │          │  fetchModels()                       │  │
│  │  Picker  ────┼──────────┼──► static MODEL_OPTIONS              │  │
│  │              │          │  + loadProvidersConfig()   ◄── NEW   │  │
│  │  Settings ───┼──────────┼──► AddProvider flow       ◄── NEW   │  │
│  │  /connect ───┼──────────┼──► same flow              ◄── NEW   │  │
│  └──────────────┘          │  + key store (auth.json, 0600)      │  │
│                            └──────────────┬───────────────────────┘  │
└───────────────────────────────────────────┼──────────────────────────┘
                                            │
                        ~/.commandcode/providers.json  (models, baseURL, wire)
                        ~/.commandcode/auth.json      (keys, 0600)
                                            │
                                            ▼
                        ┌─────────────────────────────────┐
                        │  Harness session routing        │
                        │  (already consumes both files)  │
                        └─────────────────────────────────┘
```

### TypeScript interfaces

```typescript
// ─── Provider config (mirrors the harness providers.json schema) ──────

type ProviderWire = 'openai-completions' | 'openai-responses' | 'anthropic-messages';

interface ProviderFileEntry {
  name?: string;
  api?: ProviderWire;              // omit for OpenAI-compatible
  baseURL: string;                 // required, the API root
  apiKey?: string | false;         // "$ENV_VAR" | "{env:VAR}" | "!command" | false
  headers?: Record<string, string>;
  models: Record<string, {         // required, ≥1 or the provider is skipped
    name?: string;
    contextWindow?: number;
    maxOutput?: number;
    reasoningEfforts?: Array<'low' | 'medium' | 'high' | 'xhigh' | 'max'>;
    cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
    options?: Record<string, unknown>;
  }>;
}

// ─── Add-a-provider flow state (Settings + /connect share it) ─────────

type ProviderKeyState =
  | { kind: 'none' }                        // requests fail until a key is added
  | { kind: 'stored'; preview: string }     // sk_… ✓ stored in auth.json
  | { kind: 'reference'; var: string }      // $VAR read from the file
  | { kind: 'keyless' };                    // endpoint asks for none

type AddProviderStep =
  | { step: 'id'; query: string }           // searchable known-provider list
  | { step: 'wire'; api: ProviderWire }
  | { step: 'endpoint'; baseURL: string }
  | { step: 'key'; value: string | null }   // null = keyless (local servers)
  | { step: 'models'; discovered: string[]; manual: string[] }
  | { step: 'review' };

interface ProviderDraft {
  id: string;                                // lowercase handle, prefixes model ids
  name?: string;
  api: ProviderWire;
  baseURL: string;
  key: ProviderKeyState;
  models: string[];
}

// ─── Picker grouping ───────────────────────────────────────────────────

interface PickerGroup {
  source: 'command-code' | 'byok';
  providerId: string;                       // 'deepseek', 'ollama', 'work-llm', …
  label: string;                            // "DeepSeek (byok)"
  models: Array<{ id: string; name?: string; contextWindow?: number }>;
}
```

### Phase 1 — Read parity (BYOK models in the picker)

Merge the harness's `loadProvidersConfig()` output into `fetchModels()`:

- Each valid provider becomes its own picker group, labelled `<name> (byok)` — same convention the CLI's `--list-models` already prints.
- **Invalid config must surface, not vanish.** The CLI warns per-entry (`providers.json needs attention — provider.work-llm: no baseURL configured — provider skipped`). The picker should show the same one-line warnings under the list so "listed but broken" is distinguishable from "not listed".
- No write path, no new UI beyond the group headers. This alone unblocks users who configure via the CLI (the desktop#72 workaround) and closes the "restart doesn't help" confusion.

### Phase 2 — Write parity ("Add a provider" in Settings)

A single flow, reusable from Settings and (Phase 3) the command palette:

1. **id** — type-to-search over the known-provider registry (same models.dev catalog the CLI wizard uses; endpoint + wire prefill on selection), or a free-form id for fully custom/local.
2. **wire** — OpenAI-compatible (default) / OpenAI Responses / Anthropic.
3. **endpoint** — the API root; a pasted URL carrying a route suffix (`…/v1/chat/completions`) is trimmed to the root, as the CLI does.
4. **key** — paste to store in `auth.json` (0600), or skip for keyless local endpoints. **Raw keys are never written to `providers.json`** — the file accepts references only (`"$VAR"`, `"{env:VAR}"`, `"!command"`), matching the CLI's refusal behaviour.
5. **models** — silent discovery from the endpoint's `/models` (registry first, endpoint as fallback), with a manual-entry escape hatch when discovery comes up empty.
6. **review** — the card the CLI's `/connect` shows: endpoint, model count, key state, and actions (save key / replace / clear / update models / delete).

### Phase 3 — Command parity (`/connect` in the palette)

- Add `/connect` ("Connect to AI providers. Command Code, BYOK providers and API keys") to the desktop renderer's slash-command list, opening the Phase 2 flow.
- Fix the stale error copy in the same release: either the desktop now has `/connect` (copy becomes correct) or, if Phase 3 ships separately, the message should say "in the Command Code CLI" unambiguously.

### Settings schema

```jsonc
// ~/.commandcode/config.json (desktop-relevant subset)
{
  "desktop": {
    "byok": {
      "showInModelPicker": true,     // Phase 1 gate
      "addProviderFlow": true        // Phase 2/3 gate
    }
  }
}
```

## Rollout

| Phase | Ships behind | Risk |
|---|---|---|
| 1 — read parity | `desktop.byok.showInModelPicker` | Low: read-only; worst case is a confusing group label |
| 2 — write parity | `desktop.byok.addProviderFlow` | Medium: writes shared stores; needs the same parse-refusal guards the CLI has (never touch a file that fails to parse) |
| 3 — command parity | same flag | Low: thin wrapper over Phase 2 |

## Test plan

- **Read**: `providers.json` with (a) valid provider, (b) invalid entry alongside a valid one (warning shown, sibling unaffected), (c) key stored vs `$VAR` reference vs `false`, (d) empty models (provider skipped).
- **Write**: add known provider (prefill), add custom provider (manual baseURL), keyless local endpoint, discovery failure → manual models, key lands in `auth.json` with `0600`, raw key never lands in `providers.json`, unparseable file is never modified.
- **Parity**: the same config produced via desktop flow is consumed correctly by the CLI (`cmd --list-models` shows the provider) and vice versa.
- **Regression**: picker unchanged when `providers.json` absent.

## Alternatives considered

- **Docs-only**: document "use the CLI for BYOK". Rejected — leaves desktop-only users stuck, and the desktop's own error copy references a command it doesn't have.
- **Desktop-private key store**: a desktop-only config file. Rejected — diverges from the CLI's stores and breaks the "backtest = paper = live"-style single-source-of-truth the shared files already give.
- **Ship only Phase 1**: tempting (smallest diff, unblocks CLI-configured users) but it leaves no desktop-native onboarding; Phase 2 is what makes the desktop self-sufficient.

## Open questions

1. Should the desktop re-run model discovery on a schedule (the CLI refetches via `u` on the provider card), or only on explicit action?
2. Does the desktop picker need the per-model `reasoningEfforts` editor the CLI leaves to hand-editing `providers.json`?
3. Should desktop show BYOK usage/cost (models declare `cost`), or is that out of scope until the CLI has it?
