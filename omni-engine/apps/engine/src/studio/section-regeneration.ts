import type {
  SectionRegenerationRequest,
  SectionRegenerationContract
} from "./edit-contracts.js";

export interface SectionTarget {
  id: string;
  html: string;
  start: number;
  end: number;
}

export interface SectionReplacementResult {
  html: string;
  replacedSectionId: string;
  changed: boolean;
}

export interface AssetRegenerationRequest {
  assetId: string;
  sectionId?: string;
  instruction: string;
  currentUrl?: string;
  kind: "image" | "background" | "visual";
}

export interface AssetRegenerationContract {
  preserveLayout: true;
  preserveCopy: true;
  preserveUnrelatedAssets: true;
  preserveOutsideTarget: true;
  targetAssetId: string;
  targetSectionId?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findOpeningTag(
  html: string,
  attribute: string,
  value: string
): { index: number; end: number; tag: string } | null {
  const safe = escapeRegExp(value);

  const pattern = new RegExp(
    `<([a-zA-Z][\\w:-]*)\\b[^>]*\\b${attribute}\\s*=\\s*(["'])${safe}\\2[^>]*>`,
    "i"
  );

  const match = pattern.exec(html);

  if (!match || match.index === undefined) {
    return null;
  }

  return {
    index: match.index,
    end: match.index + match[0].length,
    tag: match[1].toLowerCase()
  };
}

function findBalancedElementEnd(
  html: string,
  opening: { index: number; end: number; tag: string }
): number | null {
  const tag = escapeRegExp(opening.tag);
  const token = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");

  token.lastIndex = opening.index;

  let depth = 0;
  let match: RegExpExecArray | null;

  while ((match = token.exec(html))) {
    const raw = match[0];

    if (/^<\//.test(raw)) {
      depth -= 1;

      if (depth === 0) {
        return match.index + raw.length;
      }
    } else if (!/\/>$/.test(raw)) {
      depth += 1;
    }
  }

  return null;
}

export function findSectionById(
  html: string,
  sectionId: string
): SectionTarget | null {
  const opening = findOpeningTag(
    html,
    "data-veyra-section",
    sectionId
  );

  if (!opening) {
    return null;
  }

  const end = findBalancedElementEnd(html, opening);

  if (end === null) {
    return null;
  }

  return {
    id: sectionId,
    html: html.slice(opening.index, end),
    start: opening.index,
    end
  };
}

export function replaceSectionById(
  documentHtml: string,
  sectionId: string,
  replacementHtml: string
): SectionReplacementResult {
  const target = findSectionById(documentHtml, sectionId);

  if (!target) {
    throw new Error(
      `Veyra could not find section "${sectionId}" in the current project.`
    );
  }

  const replacement = replacementHtml.trim();

  if (!replacement) {
    throw new Error("Replacement section HTML cannot be empty.");
  }

  if (
    !replacement.includes(`data-veyra-section="${sectionId}"`) &&
    !replacement.includes(`data-veyra-section='${sectionId}'`)
  ) {
    throw new Error(
      `Replacement must preserve data-veyra-section="${sectionId}".`
    );
  }

  const html =
    documentHtml.slice(0, target.start) +
    replacement +
    documentHtml.slice(target.end);

  return {
    html,
    replacedSectionId: sectionId,
    changed: html !== documentHtml
  };
}

export function sectionRegenerationContext(
  request: SectionRegenerationRequest,
  currentHtml: string
): string {
  const target = findSectionById(
    currentHtml,
    request.sectionId
  );

  if (!target) {
    throw new Error(
      `Section "${request.sectionId}" does not exist.`
    );
  }

  const contract: SectionRegenerationContract = {
    sectionId: request.sectionId,
    preserveOutsideSection: true,
    preserveGlobalBrandSystem: true,
    preserveWorkingInteractions: true,
    preserveUnrelatedAssets: true
  };

  return [
    "VEYRA SECTION REGENERATION MODE",
    "",
    "This is NOT a full-site redesign.",
    "Modify only the selected section.",
    "Everything outside the selected section is immutable.",
    "Preserve the section's data-veyra-section value.",
    "Preserve stable data-veyra-id values when the same semantic element remains.",
    "Keep the existing global visual language, typography system, spacing logic, brand system and responsive behavior.",
    "Do not invent unrelated content, facts, prices, testimonials or links.",
    "",
    `USER INSTRUCTION:\n${request.instruction}`,
    "",
    `SECTION CONTRACT:\n${JSON.stringify(contract, null, 2)}`,
    "",
    `CURRENT TARGET SECTION:\n${target.html}`,
    "",
    "Return the replacement section only."
  ].join("\n");
}

export function assetRegenerationContext(
  request: AssetRegenerationRequest
): string {
  const contract: AssetRegenerationContract = {
    preserveLayout: true,
    preserveCopy: true,
    preserveUnrelatedAssets: true,
    preserveOutsideTarget: true,
    targetAssetId: request.assetId,
    targetSectionId: request.sectionId
  };

  return [
    "VEYRA ASSET REGENERATION MODE",
    "",
    "Regenerate or replace only the selected visual asset.",
    "Do not redesign the surrounding website.",
    "Do not rewrite unrelated copy.",
    "Maintain the existing art direction unless the user explicitly requests a change.",
    "",
    `USER INSTRUCTION:\n${request.instruction}`,
    "",
    `ASSET CONTRACT:\n${JSON.stringify(contract, null, 2)}`,
    "",
    request.currentUrl
      ? `CURRENT ASSET URL:\n${request.currentUrl}`
      : ""
  ].filter(Boolean).join("\n");
}
