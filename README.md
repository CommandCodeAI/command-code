# clai-old

A tiny coding agent built on the **old** OpenAI completions API (`/v1/completions`, `gpt-3.5-turbo-instruct`). No tool-calling API, no SDK, no dependencies — just text in, text out, and a manual JSON parser that drives a few CRUD tools and a shell.

It is intentionally a single-file agent: `agent.js`, ~150 lines, no comments. Think of it as a GPT-2/GPT-3 era ReAct loop.

## How it works

1. The runner sends a prompt to `/v1/completions`.
2. The model is told to reply with **one JSON object per turn** describing a tool call.
3. The runner extracts the JSON, dispatches the tool, and feeds the result back as a line beginning with `OBSERVATION:`.
4. Repeat until the model emits `{"tool":"done", ...}` or `MAX_STEPS` is hit.

A `\nOBSERVATION:` stop sequence keeps the model from hallucinating its own tool results.

```
TASK: <your task>
{"tool":"read","args":{"path":"package.json"}}
OBSERVATION: { ... file contents ... }
{"tool":"shell","args":{"cmd":"node -v"}}
OBSERVATION: v22.4.1
{"tool":"done","args":{"answer":"Node 22 detected."}}
```

## Tools

| tool     | args                                | effect                        |
| -------- | ----------------------------------- | ----------------------------- |
| `create` | `{ path, content }`                 | write a new file              |
| `read`   | `{ path }`                          | return file contents (utf-8)  |
| `update` | `{ path, content }`                 | overwrite an existing file    |
| `delete` | `{ path }`                          | unlink a file                 |
| `shell`  | `{ cmd }`                           | run a shell command, capture stdout |
| `done`   | `{ answer }`                        | end the loop                  |

`create` and `update` are the same operation under the hood — the split exists only so the model can be explicit about intent.

## Install

Requires Node 18+ (uses the built-in `fetch`).

```bash
git clone https://github.com/ahmadawais/clai-old.git
cd clai-old
npm install   # no-op, there are no deps
```

## Run

```bash
export OPENAI_API_KEY=sk-...
node agent.js "list every .md file in this repo and summarise each in one line"
```

Or interactively:

```bash
node agent.js
task> _
```

Or via the bin:

```bash
npm start
```

## Environment variables

| var               | default                   | meaning                          |
| ----------------- | ------------------------- | -------------------------------- |
| `OPENAI_API_KEY`  | —                         | required                         |
| `CLAI_MODEL`      | `gpt-3.5-turbo-instruct`  | any completions-API model        |
| `CLAI_STEPS`      | `20`                      | max tool-call iterations         |
| `CLAI_MAX_TOKENS` | `1024`                    | per-completion token cap         |

## ⚠️ Safety

`shell` runs **whatever the model emits**, with your shell, in your CWD. There is no sandbox, no allowlist, no confirmation prompt. Run it in a throwaway directory or a container. Don't point this at a repo you care about.

## Why?

Because sometimes you want to remember what an agent looked like before tool-calling APIs, before SDKs, before frameworks — when the whole loop fit in one file and the model was just a text predictor.

## License

MIT
