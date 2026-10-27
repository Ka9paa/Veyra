import {
  orchestrateStudio,
  orchestrateStudioPlan,
  orchestrateStudioBuildStage,
  orchestrateStudioRecomposeStage
} from "./agents/studio-orchestrator.js";

async function main() {
  // Flask expects stdout to contain ONLY the final JSON result.
  // Send V4 progress/logging to stderr.
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

  const buildRequest = {
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
    },

    uploadedImages: Array.isArray(request.images)
      ? request.images
      : []
  };

  const stage = String(request.stage || "legacy").toLowerCase();

  console.error(`[Veyra V4 CLI] stage=${stage}`);

  let result;

  if (stage === "plan") {
    result = await orchestrateStudioPlan(buildRequest);

  } else if (stage === "build") {
    if (!request.plan) {
      throw new Error("V4 CLI build stage received no plan.");
    }

    result = await orchestrateStudioBuildStage(
      buildRequest,
      request.plan
    );

  } else if (stage === "recompose") {
    if (!request.plan) {
      throw new Error("V4 CLI recompose stage received no plan.");
    }

    if (!request.candidate) {
      throw new Error("V4 CLI recompose stage received no candidate.");
    }

    if (!request.best) {
      throw new Error("V4 CLI recompose stage received no best candidate.");
    }

    result = await orchestrateStudioRecomposeStage(
      buildRequest,
      request.plan,
      request.candidate,
      request.best,
      Number(request.attempt || 1)
    );

  } else if (stage === "legacy") {
    result = await orchestrateStudio(buildRequest);

  } else {
    throw new Error(`Unknown V4 CLI stage: ${stage}`);
  }

  process.stdout.write(JSON.stringify(result));
}

main().catch((error) => {
  console.error("[Veyra V4 CLI]", error);
  process.exitCode = 1;
});
