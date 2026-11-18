import { readFile } from "node:fs/promises";
import process from "node:process";

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const TAG_PATTERN = /^[a-z0-9-]+$/;
const KIND_VALUES = new Set(["tool", "command", "hook", "provider", "renderer", "flag"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const URI_PATTERN = /^[a-z][a-z\d+.-]*:[^\s]+$/i;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function addError(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

function validateRegistry(registry) {
  const errors = [];

  if (!isObject(registry)) {
    return ["registry: expected an object"];
  }

  if (registry.version !== 1) {
    addError(errors, "version", "must be 1");
  }

  if (!Array.isArray(registry.mods)) {
    return [...errors, "mods: expected an array"];
  }

  if ("hidden" in registry) {
    if (!Array.isArray(registry.hidden)) {
      addError(errors, "hidden", "expected an array");
    } else if (new Set(registry.hidden).size !== registry.hidden.length) {
      addError(errors, "hidden", "must contain unique values");
    }
  }

  const names = new Set();
  for (const [index, mod] of registry.mods.entries()) {
    const path = `mods[${index}]`;
    if (!isObject(mod)) {
      addError(errors, path, "expected an object");
      continue;
    }

    for (const field of ["name", "source", "description", "author", "kinds"]) {
      if (!(field in mod)) {
        addError(errors, `${path}.${field}`, "is required");
      }
    }

    if (typeof mod.name === "string") {
      if (!NAME_PATTERN.test(mod.name)) {
        addError(errors, `${path}.name`, "must use lowercase letters, numbers, '.', '_' or '-'");
      }
      if (names.has(mod.name)) {
        addError(errors, `${path}.name`, `duplicates "${mod.name}"`);
      }
      names.add(mod.name);
    } else if ("name" in mod) {
      addError(errors, `${path}.name`, "expected a string");
    }

    if (typeof mod.source !== "string") {
      addError(errors, `${path}.source`, "expected a string");
    }

    if (typeof mod.description !== "string") {
      addError(errors, `${path}.description`, "expected a string");
    } else if (mod.description.length > 240) {
      addError(errors, `${path}.description`, "must be at most 240 characters");
    }

    if (!isObject(mod.author)) {
      addError(errors, `${path}.author`, "expected an object");
    } else if (typeof mod.author.name !== "string") {
      addError(errors, `${path}.author.name`, "expected a string");
    }

    if (!Array.isArray(mod.kinds) || mod.kinds.length === 0) {
      addError(errors, `${path}.kinds`, "must contain at least one kind");
    } else {
      if (new Set(mod.kinds).size !== mod.kinds.length) {
        addError(errors, `${path}.kinds`, "must contain unique values");
      }
      for (const kind of mod.kinds) {
        if (!KIND_VALUES.has(kind)) {
          addError(errors, `${path}.kinds`, `contains unsupported kind "${kind}"`);
        }
      }
    }

    if (mod.tags !== undefined) {
      if (!Array.isArray(mod.tags)) {
        addError(errors, `${path}.tags`, "expected an array");
      } else {
        if (new Set(mod.tags).size !== mod.tags.length) {
          addError(errors, `${path}.tags`, "must contain unique values");
        }
        for (const tag of mod.tags) {
          if (typeof tag !== "string" || !TAG_PATTERN.test(tag)) {
            addError(errors, `${path}.tags`, `contains invalid tag "${tag}"`);
          }
        }
      }
    }

    for (const field of ["repo", "author.url"]) {
      const value = field === "repo" ? mod.repo : mod.author?.url;
      if (value !== undefined && (typeof value !== "string" || !URI_PATTERN.test(value))) {
        addError(errors, `${path}.${field}`, "must be a URI");
      }
    }

    if (mod.addedAt !== undefined && (typeof mod.addedAt !== "string" || !DATE_PATTERN.test(mod.addedAt))) {
      addError(errors, `${path}.addedAt`, "must use YYYY-MM-DD format");
    }
  }

  return errors;
}

export { validateRegistry };

if (process.argv[1] === new URL(import.meta.url).pathname.replaceAll("\\", "/")) {
  const file = process.argv[2] ?? new URL("./registry.json", import.meta.url);
  const registry = JSON.parse(await readFile(file, "utf8"));
  const errors = validateRegistry(registry);

  if (errors.length > 0) {
    console.error(errors.map((error) => `- ${error}`).join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`Validated ${registry.mods.length} mod entries.`);
  }
}
