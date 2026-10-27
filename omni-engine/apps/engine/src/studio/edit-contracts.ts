export type StudioEditableKind =
  | "text"
  | "image"
  | "button"
  | "link"
  | "section"
  | "container";

export interface StudioEditableTarget {
  id: string;
  kind: StudioEditableKind;
  label?: string;
  sectionId?: string;
}

export type StudioEditOperation =
  | {
      type: "replace-text";
      targetId: string;
      value: string;
    }
  | {
      type: "replace-image";
      targetId: string;
      src: string;
      alt?: string;
    }
  | {
      type: "set-link";
      targetId: string;
      href: string;
    }
  | {
      type: "set-attribute";
      targetId: string;
      name: string;
      value: string;
    }
  | {
      type: "set-style-token";
      targetId: string;
      token: string;
      value: string;
    };

export interface SectionRegenerationRequest {
  projectId?: string;
  sectionId: string;
  instruction: string;

  currentHtml: string;
  currentCss: string;
  currentJs: string;

  preserveOutsideSection: true;
}

export interface SectionRegenerationContract {
  sectionId: string;

  preserveOutsideSection: true;
  preserveGlobalBrandSystem: true;
  preserveWorkingInteractions: true;
  preserveUnrelatedAssets: true;
}

export interface StudioVersionSnapshot {
  id: string;
  createdAt: string;
  label: string;

  html: string;
  css: string;
  js: string;
}

export function studioEditingContext(): string {
  return [
    "=== VEYRA STUDIO EDITABILITY CONTRACT ===",
    "",
    "Generated pages must remain structurally editable inside Veyra Studio.",
    "",
    "Important user-facing text, images, buttons, links, containers, and major sections should receive stable data-veyra-id attributes.",
    "",
    "Major sections should also receive stable data-veyra-section attributes.",
    "",
    "IDs must be semantic and stable across small revisions when the same logical element still exists.",
    "",
    "Do not place essential editable copy only inside pseudo-elements, canvas, SVG paths, or raster images.",
    "",
    "Do not make ordinary content editing require regeneration of the entire website.",
    "",
    "Section-level regeneration must preserve content and behavior outside the targeted section unless the user's instruction explicitly requires a global change.",
    "",
    "Image replacement should not require rewriting unrelated typography, layout, or copy.",
    "",
    "Text replacement should preserve the surrounding component and styling unless the new content makes a layout adjustment necessary."
  ].join("\n");
}
