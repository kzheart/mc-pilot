import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const PROTOCOL_FILES = ["actions.json", "queries.json", "errors.json"];

// These names were already reserved by the protocol before handlers existed.
// Keep reasons, and fail if an exception becomes obsolete or names no contract.
const PLANNED_ACTIONS = {
  "channel.listen": "Reserved custom-channel query; no handler is implemented yet.",
  "channel.send": "Reserved custom-channel action; no handler is implemented yet.",
  "effects.particles": "Reserved particle query; no handler is implemented yet.",
  "effects.sounds": "Reserved sound query; no handler is implemented yet.",
};

export const HANDLER_FAMILIES = [
  {
    name: "yarn",
    directory: "client-mod/shared/java/com/mct/core/handler",
    unsupportedActions: { ...PLANNED_ACTIONS },
  },
  {
    name: "official",
    directory: "client-mod/shared/java-official/com/mct/core/handler",
    unsupportedActions: { ...PLANNED_ACTIONS },
  },
  {
    name: "legacy",
    directory: "client-mod/shared/forge-1.12/java/com/mct/legacy",
    unsupportedActions: { ...PLANNED_ACTIONS },
  },
];

const ACTION_NAME = "[a-z]+\\.[a-z0-9]+(?:[.-][a-z0-9]+)*";

/** Read literal dispatch names, not arbitrary strings or commented-out code. */
export function extractHandlerActions(source) {
  const uncommented = source.replace(
    /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (token) => token.startsWith("//") || token.startsWith("/*") ? " " : token,
  );
  const actions = new Set();
  const cases = /\bcase\s+("(?:\\.|[^"\\])*"(?:\s*,\s*"(?:\\.|[^"\\])*")*)\s*(?:->|:)/g;
  for (const match of uncommented.matchAll(cases)) {
    for (const name of match[1].matchAll(new RegExp(`"(${ACTION_NAME})"`, "g"))) {
      actions.add(name[1]);
    }
  }
  for (const pattern of [
    new RegExp(`\\baction\\s*\\.\\s*equals\\s*\\(\\s*"(${ACTION_NAME})"\\s*\\)`, "g"),
    new RegExp(`"(${ACTION_NAME})"\\s*\\.\\s*equals\\s*\\(\\s*action\\s*\\)`, "g"),
  ]) {
    for (const match of uncommented.matchAll(pattern)) actions.add(match[1]);
  }
  return actions;
}

function difference(left, right) {
  return [...left].filter((value) => !right.has(value)).sort();
}

export function compareHandlerContract(protocolActions, javaActions, unsupportedActions) {
  const exemptions = new Set(Object.keys(unsupportedActions));
  const missingInJava = difference(protocolActions, new Set([...javaActions, ...exemptions]));
  const missingInProtocol = difference(javaActions, protocolActions);
  const unknownExemptions = difference(exemptions, protocolActions);
  const obsoleteExemptions = [...exemptions].filter((name) => javaActions.has(name)).sort();
  const unexplainedExemptions = [...exemptions]
    .filter((name) => typeof unsupportedActions[name] !== "string" || !unsupportedActions[name].trim())
    .sort();
  return {
    success: [missingInJava, missingInProtocol, unknownExemptions, obsoleteExemptions, unexplainedExemptions]
      .every((names) => names.length === 0),
    missingInJava,
    missingInProtocol,
    unknownExemptions,
    obsoleteExemptions,
    unexplainedExemptions,
  };
}

async function readProtocolDocuments(root) {
  return Promise.all(PROTOCOL_FILES.map(async (file) => {
    const source = path.join("protocol", file);
    const raw = await readFile(path.join(root, source), "utf8");
    const document = JSON.parse(raw);
    const key = path.basename(file, ".json");
    const identifier = key === "errors" ? "code" : "name";
    if (document.schemaVersion !== 1 || !Array.isArray(document[key])) {
      throw new Error(`${source}: expected schemaVersion 1 and a ${key} array`);
    }
    const seen = new Set();
    for (const entry of document[key]) {
      const name = entry?.[identifier];
      if (typeof name !== "string" || !name || seen.has(name)) {
        throw new Error(`${source}: missing or duplicate ${identifier}: ${String(name)}`);
      }
      seen.add(name);
    }
    return { file, source, raw, document };
  }));
}

async function readPackagedCopy(root, file) {
  try {
    return await readFile(path.join(root, "cli/data/protocol", file), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function syncPackagedProtocol(root) {
  // Validate all source documents before changing any package copy.
  const documents = await readProtocolDocuments(root);
  await mkdir(path.join(root, "cli/data/protocol"), { recursive: true });
  const updatedFiles = [];
  for (const { file, raw } of documents) {
    if (await readPackagedCopy(root, file) !== raw) {
      await writeFile(path.join(root, "cli/data/protocol", file), raw, "utf8");
      updatedFiles.push(`cli/data/protocol/${file}`);
    }
  }
  return { success: true, updatedFiles };
}

export async function checkProtocolSync(root, families = HANDLER_FAMILIES) {
  const documents = await readProtocolDocuments(root);
  const protocolActions = new Set(documents.flatMap(({ document }) =>
    [...(document.actions ?? []), ...(document.queries ?? [])].map((entry) => entry.name),
  ));
  const packagedFiles = await Promise.all(documents.map(async ({ file, source, raw }) => {
    const packaged = await readPackagedCopy(root, file);
    return {
      source,
      packaged: `cli/data/protocol/${file}`,
      status: packaged === raw ? "synced" : packaged === null ? "missing" : "stale",
    };
  }));
  const handlers = await Promise.all(families.map(async (family) => {
    const directory = path.join(root, family.directory);
    const files = (await readdir(directory)).filter((file) => file.endsWith(".java")).sort();
    if (files.length === 0) throw new Error(`No Java handlers found in ${family.directory}`);
    const javaActions = new Set();
    for (const file of files) {
      for (const action of extractHandlerActions(await readFile(path.join(directory, file), "utf8"))) {
        javaActions.add(action);
      }
    }
    return {
      family: family.name,
      directory: family.directory,
      counts: { protocol: protocolActions.size, java: javaActions.size },
      unsupportedActions: family.unsupportedActions,
      ...compareHandlerContract(protocolActions, javaActions, family.unsupportedActions),
    };
  }));
  const copiesSynced = packagedFiles.every((file) => file.status === "synced");
  return {
    success: copiesSynced && handlers.every((handler) => handler.success),
    counts: { protocol: protocolActions.size },
    packagedFiles,
    handlers,
    ...(!copiesSynced ? { hint: "Run npm run sync:protocol, then review the generated package copies." } : {}),
  };
}
