export interface VeyraCreativeDirectives {
  photography: {
    mode: "image-led" | "balanced" | "supporting";
    heroPriority: "dominant" | "major" | "supporting";
    cropRules: string[];
    consistencyRules: string[];
    selectionRules: string[];
    avoid: string[];
  };

  responsive: {
    strategy: "recompose" | "compress" | "stack";
    rules: string[];
    mobileHeroRules: string[];
    touchRules: string[];
  };

  motion: {
    intensity: "restrained" | "moderate" | "expressive";
    rules: string[];
    reducedMotionRules: string[];
  };

  brand: {
    rules: string[];
    consistencyChecks: string[];
  };
}

function haystack(
  ...parts: Array<string | undefined>
): string {
  return parts
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

export function deriveCreativeDirectives(
  input: {
    prompt: string;
    designDNA?: string;
    composition?: string;
    assets?: string;
  }
): VeyraCreativeDirectives {
  const text = haystack(
    input.prompt,
    input.designDNA,
    input.composition,
    input.assets
  );

  const imageLed =
    /\b(photo|photography|editorial|cinematic|gallery|fashion|barber|restaurant|hotel|real estate|portfolio|luxury)\b/.test(
      text
    );

  const restrainedMotion =
    /\b(minimal|restrained|quiet|luxury|editorial|professional)\b/.test(
      text
    );

  return {
    photography: {
      mode: imageLed
        ? "image-led"
        : "balanced",

      heroPriority: imageLed
        ? "dominant"
        : "major",

      cropRules: [
        "Choose crop and orientation for the actual compositional slot.",
        "Protect faces, products, hands, text-safe negative space, and semantic focal points from destructive crops.",
        "Prefer images whose subject placement supports the planned typography position.",
        "Recompose or recrop intentionally for mobile instead of shrinking the desktop crop."
      ],

      consistencyRules: [
        "Keep lighting, contrast, color temperature, subject treatment, and photographic polish coherent across the page.",
        "Avoid mixing obviously incompatible stock-photo styles unless the contrast is intentional.",
        "Do not repeat the same photograph in multiple major visual roles.",
        "Supporting photography should extend the visual story rather than duplicate the hero."
      ],

      selectionRules: [
        "Hero imagery must materially support the first-viewport composition.",
        "Prefer useful negative space when typography overlaps or sits beside photography.",
        "Match portrait photography to portrait slots and landscape photography to wide slots when possible.",
        "Prefer believable professional photography over generic decorative imagery.",
        "Use imagery as composition, not merely as card decoration."
      ],

      avoid: [
        "random stock-photo feel",
        "tiny decorative hero thumbnails when the concept is image-led",
        "false claims that stock photography depicts actual staff or customers",
        "SVG, canvas, CSS illustration, emoji, or gradients as substitutes for real-world photographic subjects"
      ]
    },

    responsive: {
      strategy: "recompose",

      rules: [
        "Treat desktop, tablet, and mobile as related compositions rather than one layout mechanically stacked downward.",
        "Preserve hierarchy and conversion intent while changing geometry when space collapses.",
        "Prevent headline collisions, clipped imagery, horizontal overflow, unusable controls, and accidental dead space.",
        "Allow grids, overlaps, split heroes, galleries, and editorial compositions to transform into purpose-built mobile arrangements.",
        "Preserve the selected Design Direction's personality across breakpoints."
      ],

      mobileHeroRules: [
        "Keep the primary message visible without horizontal scrolling.",
        "Re-evaluate image crop, type scale, CTA position, and overlap independently for mobile.",
        "Do not preserve desktop asymmetry when it damages comprehension on narrow screens.",
        "Keep the primary CTA obvious and reachable."
      ],

      touchRules: [
        "Interactive targets must remain comfortably tappable.",
        "Hover-only information must have a touch-accessible equivalent.",
        "Navigation and primary actions must remain obvious and operable.",
        "Avoid interaction patterns that depend on precise pointer placement."
      ]
    },

    motion: {
      intensity: restrainedMotion
        ? "restrained"
        : "moderate",

      rules: [
        "Motion must reinforce hierarchy, spatial relationships, storytelling, or feedback.",
        "Do not animate everything.",
        "Use a small coherent motion vocabulary across the page.",
        "Prefer transform and opacity animation over layout-thrashing effects.",
        "Keep entrance choreography short enough that content never feels blocked.",
        "Use image reveals, typography entrances, hover feedback, and section transitions only when they strengthen the selected concept."
      ],

      reducedMotionRules: [
        "Respect prefers-reduced-motion.",
        "Remove nonessential parallax, large transforms, and continuous motion when reduced motion is requested.",
        "Content and controls must remain fully usable without animation."
      ]
    },

    brand: {
      rules: [
        "Use a coherent display and body typography relationship.",
        "Keep accent-color behavior intentional and repeatable.",
        "Maintain a consistent spacing rhythm while allowing deliberate editorial exceptions.",
        "Keep border radius, border weight, shadow language, icon treatment, and button behavior internally consistent.",
        "Preserve the selected Design Direction's visual personality through every section.",
        "Do not introduce arbitrary visual systems halfway through the page."
      ],

      consistencyChecks: [
        "No unexplained new colors.",
        "No one-off component styling that breaks the visual language.",
        "No generic SaaS cards unless the concept actually calls for them.",
        "No section should look imported from a different template.",
        "Typography hierarchy must remain recognizable across the entire experience."
      ]
    }
  };
}

export function creativeDirectiveContext(
  directives: VeyraCreativeDirectives
): string {
  return [
    "=== VEYRA CREATIVE DIRECTORS ===",
    "",
    "These directives are deterministic implementation guardrails derived from the current project.",
    "They do not replace the selected Design Direction.",
    "They protect and strengthen it during composition and implementation.",
    "",
    JSON.stringify(
      directives,
      null,
      2
    )
  ].join("\n");
}
