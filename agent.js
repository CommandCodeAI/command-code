#!/usr/bin/env node
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, exit } from "node:process";

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.CLAI_MODEL || "gpt-3.5-turbo-instruct";
const ENDPOINT = "https://api.openai.com/v1/completions";
const MAX_STEPS = Number(process.env.CLAI_STEPS || 20);
const MAX_TOKENS = Number(process.env.CLAI_MAX_TOKENS || 1024);

const SYSTEM = `You are clai-old, a coding agent. You only speak by emitting one JSON object per turn, nothing else.
Available tools:
{"tool":"create","args":{"path":"<file>","content":"<text>"}}
{"tool":"read","args":{"path":"<file>"}}
{"tool":"update","args":{"path":"<file>","content":"<text>"}}
{"tool":"delete","args":{"path":"<file>"}}
{"tool":"shell","args":{"cmd":"<command>"}}
{"tool":"done","args":{"answer":"<final answer>"}}
After you emit a JSON object you will receive a line beginning with OBSERVATION: containing the tool result. Then emit the next JSON. Never emit prose outside JSON. Stop by calling tool "done".

TASK: `;

async function complete(prompt) {
  if (!API_KEY) {
    console.error("OPENAI_API_KEY is not set");
    exit(1);
  }
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      stop: ["\nOBSERVATION:", "\nTASK:"],
    }),
  });
  const body = await res.json();
  if (!res.ok || !body.choices) {
    throw new Error(`api error: ${JSON.stringify(body)}`);
  }
  return body.choices[0].text;
}

function extractJson(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try { return JSON.parse(slice); } catch { return null; }
      }
    }
  }
  return null;
}

function runTool(name, args) {
  const a = args || {};
  switch (name) {
    case "create":
    case "update":
      writeFileSync(a.path, a.content ?? "");
      return `wrote ${a.path} (${(a.content ?? "").length} bytes)`;
    case "read":
      return readFileSync(a.path, "utf8");
    case "delete":
      unlinkSync(a.path);
      return `deleted ${a.path}`;
    case "shell":
      return execSync(a.cmd, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 10 * 1024 * 1024,
      });
    default:
      return `unknown tool: ${name}`;
  }
}

function trim(s, n = 4000) {
  if (s.length <= n) return s;
  return s.slice(0, n) + `\n[...truncated ${s.length - n} chars]`;
}

async function main() {
  let task = process.argv.slice(2).join(" ").trim();
  if (!task) {
    const rl = createInterface({ input: stdin, output: stdout });
    task = (await rl.question("task> ")).trim();
    rl.close();
  }
  if (!task) exit(0);

  let prompt = SYSTEM + task + "\n";
  for (let step = 0; step < MAX_STEPS; step++) {
    const out = await complete(prompt);
    stdout.write(out);
    const call = extractJson(out);
    prompt += out;
    if (!call) {
      stdout.write("\n[stop: no JSON in output]\n");
      return;
    }
    if (call.tool === "done") {
      stdout.write(`\n[done] ${call.args?.answer ?? ""}\n`);
      return;
    }
    let obs;
    try { obs = String(runTool(call.tool, call.args)); }
    catch (e) { obs = `error: ${e.message}`; }
    const line = `\nOBSERVATION: ${trim(obs)}\n`;
    stdout.write(line);
    prompt += line;
  }
  stdout.write(`\n[stop: hit MAX_STEPS=${MAX_STEPS}]\n`);
}

main().catch((e) => {
  console.error(e);
  exit(1);
});
