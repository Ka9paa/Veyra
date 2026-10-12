import {
  PatchSetSchema,
  ProjectSnapshotSchema,
  type PatchSet,
  type ProjectSnapshot,
} from "../agents/types";

function normalizePath(input: string): string {
  const normalized = input
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\/+/g, "/")
    .trim();

  if (!normalized) throw new Error("Patch path cannot be empty.");

  if (
    normalized.startsWith("/") ||
    normalized.includes("../") ||
    normalized === ".."
  ) {
    throw new Error(`Unsafe patch path: ${input}`);
  }

  return normalized;
}

function sortFiles(project: ProjectSnapshot): ProjectSnapshot {
  return {
    files: [...project.files].sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export function applyPatchSet(
  inputProject: ProjectSnapshot,
  inputPatch: PatchSet,
): ProjectSnapshot {
  const project = ProjectSnapshotSchema.parse(inputProject);
  const patch = PatchSetSchema.parse(inputPatch);

  const fileMap = new Map(
    project.files.map((file) => [normalizePath(file.path), file.content]),
  );

  for (const operation of patch.operations) {
    const path = normalizePath(operation.path);

    switch (operation.type) {
      case "create":
        if (fileMap.has(path)) {
          throw new Error(
            `Deterministic patch failure: cannot create existing file "${path}".`,
          );
        }
        fileMap.set(path, operation.content);
        break;

      case "replace":
        if (!fileMap.has(path)) {
          throw new Error(
            `Deterministic patch failure: cannot replace missing file "${path}".`,
          );
        }
        fileMap.set(path, operation.content);
        break;

      case "delete":
        if (!fileMap.has(path)) {
          throw new Error(
            `Deterministic patch failure: cannot delete missing file "${path}".`,
          );
        }
        fileMap.delete(path);
        break;
    }
  }

  return sortFiles({
    files: [...fileMap.entries()].map(([path, content]) => ({ path, content })),
  });
}

export function snapshotToContext(project: ProjectSnapshot): string {
  const parsed = ProjectSnapshotSchema.parse(project);

  return parsed.files
    .map(
      (file) =>
        `\n--- FILE: ${normalizePath(file.path)} ---\n${file.content}\n--- END FILE ---`,
    )
    .join("\n");
}
