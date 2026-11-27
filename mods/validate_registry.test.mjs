import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { validateRegistry } from "./validate_registry.mjs";

const registry = JSON.parse(await readFile(new URL("./registry.json", import.meta.url), "utf8"));

test("the checked-in registry is valid", () => {
  assert.deepEqual(validateRegistry(registry), []);
});

test("duplicate names are rejected", () => {
  const candidate = structuredClone(registry);
  candidate.mods.push({ ...candidate.mods[0] });

  assert.match(validateRegistry(candidate).join("\n"), /duplicates/);
});

test("overlong descriptions are rejected", () => {
  const candidate = structuredClone(registry);
  candidate.mods[0].description = "x".repeat(241);

  assert.match(validateRegistry(candidate).join("\n"), /at most 240/);
});
