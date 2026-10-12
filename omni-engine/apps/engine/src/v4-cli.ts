import { orchestrateStudio } from "./agents/studio-orchestrator.js";

async function main() {
  // The Flask bridge expects stdout to contain ONLY the final JSON result.
  // V4 internally uses console.log() for progress, so redirect those logs
  // to stderr while this CLI is running.
  console.log = (...args: unknown[]) => {
    console.error(...args);
  };

  console.info = (...args: unknown[]) => {
    console.error(...args);
  };

  let input = "";

  for await (const chunk of process.stdin) {
    input += chunk;
  }

  if (!input.trim()) {
    throw new Error("V4 CLI received no request.");
  }

  const request = JSON.parse(input);

  const result = await orchestrateStudio({
    projectId:
      typeof request.projectId === "string"
        ? request.projectId
        : undefined,

    userId:
      typeof request.userId === "string"
        ? request.userId
        : undefined,

    prompt: String(request.prompt || ""),

    current: {
      html: String(request.current?.html || ""),
      css: String(request.current?.css || ""),
      js: String(request.current?.js || "")
    },

    viewport: {
      width: Number(request.viewport?.width || 1440),
      height: Number(request.viewport?.height || 900)
    }
  });

  process.stdout.write(JSON.stringify(result));
}

main().catch((error) => {
  console.error("[Veyra V4 CLI]", error);
  process.exitCode = 1;
});
