export type ResponsivePriority =
  | "critical"
  | "important"
  | "supporting";

export type ResponsiveTransformation =
  | "preserve"
  | "stack"
  | "reorder"
  | "collapse"
  | "scroll"
  | "simplify"
  | "recompose";

export interface ResponsiveBreakpoint {
  id: "mobile" | "tablet" | "desktop";
  minWidth: number;
  maxWidth?: number;
}

export interface ResponsiveSectionRule {
  section: string;
  priority: ResponsivePriority;
  transformation: ResponsiveTransformation;
  rules: string[];
}

export interface ResponsiveDirectorPlan {
  strategy: "recompose-not-shrink";
  breakpoints: ResponsiveBreakpoint[];
  globalRules: string[];
  typographyRules: string[];
  navigationRules: string[];
  imageRules: string[];
  interactionRules: string[];
  sectionRules: ResponsiveSectionRule[];
  prohibitedPatterns: string[];
}

export interface ResponsiveDirectorInput {
  prompt?: string;
  designDNA?: string;
  composition?: string;
  assets?: string;
}

function joinedInput(
  input: ResponsiveDirectorInput
): string {
  return [
    input.prompt,
    input.designDNA,
    input.composition,
    input.assets
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function hasAny(
  source: string,
  terms: string[]
): boolean {
  return terms.some(term =>
    source.includes(term)
  );
}

function deriveSectionRules(
  source: string
): ResponsiveSectionRule[] {
  const rules: ResponsiveSectionRule[] = [
    {
      section: "hero",
      priority: "critical",
      transformation: "recompose",
      rules: [
        "Do not merely scale the desktop hero down.",
        "Recompose headline, supporting copy, CTA, and imagery for narrow screens.",
        "Keep the primary value proposition visible without requiring horizontal scrolling.",
        "If desktop uses overlapping imagery, preserve the visual idea through a simpler mobile crop or stack.",
        "Prevent hero media from pushing the primary CTA excessively below the fold."
      ]
    },
    {
      section: "navigation",
      priority: "critical",
      transformation: "collapse",
      rules: [
        "Collapse navigation intentionally when links cannot fit.",
        "Keep the primary action discoverable.",
        "Never allow navigation labels to collide, wrap unpredictably, or overflow the viewport.",
        "Mobile navigation controls must remain comfortably tappable."
      ]
    },
    {
      section: "content-grid",
      priority: "important",
      transformation: "stack",
      rules: [
        "Reduce column count according to available width instead of shrinking cards until unreadable.",
        "Preserve content hierarchy when cards stack.",
        "Avoid arbitrary equal heights when content length differs significantly."
      ]
    },
    {
      section: "footer",
      priority: "supporting",
      transformation: "stack",
      rules: [
        "Allow footer groups to stack cleanly.",
        "Keep legal, contact, and navigation information readable.",
        "Do not compress footer typography below usable sizes."
      ]
    }
  ];

  if (
    hasAny(source, [
      "gallery",
      "portfolio",
      "lookbook",
      "projects",
      "work grid"
    ])
  ) {
    rules.push({
      section: "gallery",
      priority: "important",
      transformation: "recompose",
      rules: [
        "Preserve photography impact on mobile.",
        "Use one or two columns according to crop shape and content density.",
        "Do not turn editorial imagery into tiny thumbnails.",
        "Maintain consistent crop logic across neighboring images."
      ]
    });
  }

  if (
    hasAny(source, [
      "pricing",
      "plans",
      "subscription"
    ])
  ) {
    rules.push({
      section: "pricing",
      priority: "important",
      transformation: "stack",
      rules: [
        "Keep plan names, prices, major benefits, and CTA visible without horizontal scrolling.",
        "Stack pricing cards when comparison width becomes cramped.",
        "Preserve the recommended-plan hierarchy without oversized mobile decoration."
      ]
    });
  }

  if (
    hasAny(source, [
      "testimonial",
      "reviews",
      "quotes"
    ])
  ) {
    rules.push({
      section: "testimonials",
      priority: "supporting",
      transformation: "scroll",
      rules: [
        "Use a touch-friendly horizontal rail only when it improves readability.",
        "Do not require tiny multi-column testimonial cards on mobile.",
        "Keep controls accessible and avoid hidden hover-only interactions."
      ]
    });
  }

  if (
    hasAny(source, [
      "dashboard",
      "table",
      "analytics",
      "data grid"
    ])
  ) {
    rules.push({
      section: "data-interface",
      priority: "important",
      transformation: "recompose",
      rules: [
        "Prioritize essential fields and actions on narrow screens.",
        "Use deliberate horizontal scrolling only for genuinely tabular data.",
        "Do not squeeze desktop tables until labels become unreadable.",
        "Move secondary actions into an accessible overflow pattern when necessary."
      ]
    });
  }

  if (
    hasAny(source, [
      "form",
      "contact",
      "booking",
      "checkout",
      "signup",
      "sign up"
    ])
  ) {
    rules.push({
      section: "forms",
      priority: "critical",
      transformation: "stack",
      rules: [
        "Form fields must fit the viewport with no horizontal clipping.",
        "Labels, validation, help text, and controls must remain readable.",
        "Use full-width or appropriately sized primary actions on mobile.",
        "Maintain clear spacing between interactive controls."
      ]
    });
  }

  return rules;
}

export function deriveResponsiveDirectorPlan(
  input: ResponsiveDirectorInput
): ResponsiveDirectorPlan {
  const source = joinedInput(input);

  const imageLed = hasAny(source, [
    "photo",
    "photography",
    "barber",
    "restaurant",
    "fashion",
    "portfolio",
    "real estate",
    "salon",
    "automotive",
    "travel",
    "hotel"
  ]);

  const denseInterface = hasAny(source, [
    "dashboard",
    "admin",
    "analytics",
    "table",
    "workspace",
    "editor",
    "studio"
  ]);

  return {
    strategy: "recompose-not-shrink",

    breakpoints: [
      {
        id: "mobile",
        minWidth: 0,
        maxWidth: 767
      },
      {
        id: "tablet",
        minWidth: 768,
        maxWidth: 1199
      },
      {
        id: "desktop",
        minWidth: 1200
      }
    ],

    globalRules: [
      "Mobile is a distinct composition, not a scaled-down desktop screenshot.",
      "No horizontal page overflow is allowed.",
      "Preserve hierarchy, meaning, and brand character at every viewport.",
      "Reorder content when desktop spatial relationships no longer make sense on mobile.",
      "Reduce decorative complexity before reducing readability.",
      "Keep critical content and primary actions discoverable.",
      "Use fluid spacing and sizing where appropriate instead of excessive breakpoint-specific patches.",
      denseInterface
        ? "For dense interfaces, preserve task completion and information hierarchy before decorative fidelity."
        : "For marketing experiences, preserve narrative rhythm and strong section transitions."
    ],

    typographyRules: [
      "Use fluid display typography with sensible minimum and maximum sizes.",
      "Prevent headings from creating accidental one-word orphan lines when practical.",
      "Do not shrink body text merely to preserve desktop line lengths.",
      "Keep readable line length and line height on small screens.",
      "Large editorial headlines may wrap differently on mobile when that produces a stronger composition."
    ],

    navigationRules: [
      "Desktop navigation may collapse into a mobile navigation pattern before links collide.",
      "Interactive navigation targets should be comfortable for touch.",
      "Primary navigation actions must remain obvious.",
      "Do not rely on hover to reveal essential navigation."
    ],

    imageRules: [
      imageLed
        ? "Photography remains a major compositional element on mobile; do not demote meaningful imagery into tiny thumbnails."
        : "Media should preserve its communicative role without dominating narrow screens.",
      "Use object-fit and deliberate object-position values rather than uncontrolled stretching.",
      "Desktop and mobile may use different crops of the same supplied source image.",
      "Preserve important subject matter when changing aspect ratio.",
      "Avoid layout shift by defining stable media dimensions or aspect ratios."
    ],

    interactionRules: [
      "Essential interactions must work with touch and keyboard, not hover alone.",
      "Avoid tiny icon-only controls without accessible labels.",
      "Maintain clear focus states.",
      "Do not place important controls so close together that accidental taps become likely.",
      "Motion must respect prefers-reduced-motion."
    ],

    sectionRules:
      deriveSectionRules(source),

    prohibitedPatterns: [
      "desktop canvas scaled down with transform",
      "horizontal body overflow",
      "unreadably small typography",
      "tiny desktop cards forced into many mobile columns",
      "hover-only essential controls",
      "fixed-width content wider than the viewport",
      "absolute-positioned text escaping its section",
      "desktop overlap patterns that collide on mobile",
      "images stretched without preserving aspect ratio",
      "mobile layout treated as an afterthought"
    ]
  };
}

export function responsiveDirectorContext(
  plan: ResponsiveDirectorPlan
): string {
  return [
    "VEYRA RESPONSIVE DIRECTOR:",
    "Responsive behavior is part of the design, not a cleanup pass.",
    "The mobile experience MUST be intentionally recomposed rather than mechanically shrunk.",
    "Builder and repair passes must preserve these responsive constraints.",
    JSON.stringify(plan, null, 2)
  ].join("\n");
}
