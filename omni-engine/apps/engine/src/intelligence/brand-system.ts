export interface BrandSystemInput {
  prompt: string;
  designDNA?: unknown;
  composition?: unknown;
  assets?: unknown;
}

export interface BrandSystemPlan {
  principle: string;
  typography: string[];
  color: string[];
  spacing: string[];
  shape: string[];
  imagery: string[];
  voice: string[];
  components: string[];
  responsive: string[];
  consistency: string[];
  prohibited: string[];
}

export function deriveBrandSystemPlan(
  _input: BrandSystemInput
): BrandSystemPlan {
  return {
    principle:
      "Treat the website as one authored visual identity rather than a collection of independently styled sections.",

    typography: [
      "Use a deliberate display, heading, body and utility hierarchy.",
      "Keep repeated heading levels typographically consistent.",
      "Do not introduce arbitrary font treatments section by section.",
      "Use scale, weight and spacing contrast intentionally.",
      "Preserve the selected design direction's typography character."
    ],

    color: [
      "Use a small intentional palette derived from the selected design direction.",
      "Assign semantic roles for background, surface, text, muted text, accent and border.",
      "Do not introduce unrelated accent colors later in the page.",
      "Maintain accessible text contrast.",
      "Use accent color strategically rather than coating every component."
    ],

    spacing: [
      "Use recurring spacing relationships instead of random values.",
      "Maintain intentional section rhythm.",
      "Dense and spacious areas must be deliberate.",
      "Related components should share padding and gap logic."
    ],

    shape: [
      "Use a coherent radius, border and shadow language.",
      "Avoid mixing unrelated card styles.",
      "Decorative geometry must support the selected art direction.",
      "Do not default every surface to a rounded rectangle."
    ],

    imagery: [
      "Keep photography treatment consistent across the experience.",
      "Maintain compatible crop behavior, contrast and visual temperature.",
      "Respect Photography Art Director focal points and text-safe areas.",
      "Do not mix premium editorial photography with unrelated generic imagery.",
      "Use imagery as composition, not decoration pasted into empty space."
    ],

    voice: [
      "Preserve the user's requested tone.",
      "Keep CTA language consistent.",
      "Avoid generic AI marketing filler.",
      "Do not fabricate business facts, testimonials, statistics or awards.",
      "Prefer specific concise copy over vague startup language."
    ],

    components: [
      "Repeated components must share visual tokens and interaction behavior.",
      "Primary CTA styling must remain recognizable across the page.",
      "Navigation controls must belong to the same component family.",
      "Cards with the same semantic role should share structural logic."
    ],

    responsive: [
      "Mobile is the same brand recomposed, not a separate visual identity.",
      "Preserve typography character while adapting scale.",
      "Preserve signature brand moments when they can survive responsively.",
      "Simplification must not erase brand character."
    ],

    consistency: [
      "Keep typography, color, spacing, shape, imagery and motion mutually coherent.",
      "Preserve the selected Design Direction throughout the full page.",
      "Signature moments may break the grid without breaking the brand.",
      "New or regenerated sections must inherit the established system."
    ],

    prohibited: [
      "No random gradients.",
      "No arbitrary glassmorphism.",
      "No inconsistent button families.",
      "No unrelated card treatments.",
      "No generic template filler sections.",
      "No visual style reset halfway through the page.",
      "No arbitrary color additions.",
      "No inconsistent photography treatment."
    ]
  };
}

export function brandSystemContext(
  plan: BrandSystemPlan
): string {
  return [
    "VEYRA BRAND SYSTEM DIRECTOR",
    "",
    plan.principle,
    "",
    JSON.stringify(plan, null, 2),
    "",
    "Enforce this brand system across the complete experience and preserve it during repair or regeneration."
  ].join("\n");
}
