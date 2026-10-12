import {
  AgentResultSchema,
  type AgentRole,
  type AgentRunRequest,
  type CoordinatorEvent,
  type ProjectSnapshot,
  type QAIssue,
} from "./types";
import { applyPatchSet, snapshotToContext } from "../project/patch";
import { generateJSON } from "../ai/provider";

type EventSink = (event: CoordinatorEvent) => void | Promise<void>;

function agentSystemPrompt(role: AgentRole): string {
  const common = `
You are one agent inside Veyra Studio's production design-to-code pipeline.

Rules:
- Return ONLY one JSON object.
- Never wrap JSON in markdown.
- Use patch operations instead of returning a whole project archive.
- Use only these operations: create, replace, delete.
- Never reference parent paths such as ../
- Preserve unrelated project behavior.
- Prefer accessible, responsive, production-quality React/Next.js code.
- Do not invent files unless needed.
`.trim();

  if (role === "designer") {
    return `${common}

You are the Designer Agent.
Own visual hierarchy, component structure, interaction design, typography,
spacing, states, accessibility foundations, and implementation quality.
Produce the smallest deterministic patch that satisfies the user's request.`;
  }

  if (role === "responsive") {
    return `${common}

You are the Responsive Agent.
Audit the Designer Agent's current project and improve responsive behavior across
mobile, tablet, desktop, overflow, touch targets, layout collapse, and readable
content density. Only patch files that actually need changes.`;
  }

  return `${common}

You are the QA Agent.
Audit the current project for visual regressions, responsive bugs, broken React/
Next.js code, invalid imports, accessibility issues, fragile states, and obvious
production defects.

If you find fixable issues, include both issues and a deterministic patch.
If the project is clean, return an empty issues array and empty operations array.`;
}

function agentPrompt(
  role: AgentRole,
  request: AgentRunRequest,
  project: ProjectSnapshot,
  priorIssues: QAIssue[] = [],
): string {
  return `
USER REQUEST:
${request.prompt}

TARGET FRAMEWORK:
${request.framework}

CURRENT PROJECT:
${snapshotToContext(project)}

${priorIssues.length ? `ISSUES TO SELF-HEAL:\n${JSON.stringify(priorIssues, null, 2)}` : ""}

ROLE:
${role}

Return JSON shaped exactly like:
{
  "role": "${role}",
  "reasoningSummary": "short implementation summary",
  "patch": {
    "summary": "what this patch changes",
    "operations": [
      { "type": "create|replace|delete", "path": "src/...", "content": "..." }
    ]
  },
  "issues": [
    {
      "severity": "info|warning|error|critical",
      "file": "optional/path",
      "message": "issue",
      "suggestion": "optional fix guidance"
    }
  ]
}

For delete operations, omit "content".
`.trim();
}

async function runAgent(
  role: AgentRole,
  request: AgentRunRequest,
  project: ProjectSnapshot,
  priorIssues: QAIssue[] = [],
) {
  const result = await generateJSON({
    system: agentSystemPrompt(role),
    prompt: agentPrompt(role, request, project, priorIssues),
    schema: AgentResultSchema,
    temperature: role === "qa" ? 0 : 0.15,
  });

  if (result.role !== role) {
    throw new Error(
      `Agent contract violation: expected "${role}", received "${result.role}".`,
    );
  }

  return result;
}

async function executeAgent(
  role: AgentRole,
  request: AgentRunRequest,
  project: ProjectSnapshot,
  sink: EventSink,
  priorIssues: QAIssue[] = [],
): Promise<ProjectSnapshot> {
  await sink({ type: "agent:start", role });

  const result = await runAgent(role, request, project, priorIssues);

  await sink({ type: "agent:complete", role, result });

  if (result.patch.operations.length === 0) return project;

  const updated = applyPatchSet(project, result.patch);

  await sink({
    type: "patch:applied",
    role,
    summary: result.patch.summary,
    project: updated,
  });

  return updated;
}

export async function coordinateAgents(
  request: AgentRunRequest,
  sink: EventSink,
): Promise<ProjectSnapshot> {
  let project = request.project;

  project = await executeAgent("designer", request, project, sink);
  project = await executeAgent("responsive", request, project, sink);

  for (let pass = 0; pass <= request.maxHealingPasses; pass += 1) {
    await sink({ type: "agent:start", role: "qa" });

    const qa = await runAgent("qa", request, project);

    await sink({ type: "agent:complete", role: "qa", result: qa });
    await sink({ type: "qa:issues", pass, issues: qa.issues });

    if (qa.patch.operations.length > 0) {
      project = applyPatchSet(project, qa.patch);

      await sink({
        type: "patch:applied",
        role: "qa",
        summary: qa.patch.summary,
        project,
      });
    }

    const blockingIssues = qa.issues.filter(
      (issue) =>
        issue.severity === "error" || issue.severity === "critical",
    );

    if (blockingIssues.length === 0) {
      await sink({ type: "complete", project });
      return project;
    }

    if (pass === request.maxHealingPasses) {
      throw new Error(
        `QA self-healing exhausted after ${request.maxHealingPasses + 1} QA pass(es).`,
      );
    }
  }

  await sink({ type: "complete", project });
  return project;
}
