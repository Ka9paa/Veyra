export type MotionIntensity =
  | "none"
  | "restrained"
  | "moderate"
  | "expressive";

export interface MotionDirectorInput {
  prompt: string;
  designDNA?: unknown;
  composition?: unknown;
  assets?: unknown;
}

export interface MotionDirectorPlan {
  intensity: MotionIntensity;
  philosophy: string;
  entrance: string[];
  interaction: string[];
  scroll: string[];
  media: string[];
  performance: string[];
  reducedMotion: string[];
  prohibited: string[];
}

function stringify(value: unknown): string {
  if (value == null) return "";

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function combined(input: MotionDirectorInput): string {
  return [
    input.prompt,
    stringify(input.designDNA),
    stringify(input.composition),
    stringify(input.assets)
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

export function deriveMotionDirectorPlan(
  input: MotionDirectorInput
): MotionDirectorPlan {
  const text = combined(input);

  const expressive =
    /\b(editorial|fashion|creative|experimental|cinematic|immersive|portfolio|music|launch|showcase)\b/.test(
      text
    );

  const restrained =
    /\b(luxury|minimal|professional|law|legal|medical|finance|financial|corporate|quiet|restrained)\b/.test(
      text
    );

  const noMotion =
    /\b(no animation|no animations|no motion|static only)\b/.test(
      text
    );

  const intensity: MotionIntensity = noMotion
    ? "none"
    : restrained
      ? "restrained"
      : expressive
        ? "expressive"
        : "moderate";

  return {
    intensity,

    philosophy:
      "Motion reinforces hierarchy, causality, spatial relationships and brand character. The experience must remain excellent with motion disabled.",

    entrance: [
      "Animate meaningful groups instead of independently animating every child.",
      "Use controlled opacity and transform reveals with intentional staggering.",
      "Give the hero one clear focal sequence rather than competing animations.",
      "Never delay usability for decorative animation."
    ],

    interaction: [
      "Buttons and links may use subtle hover, focus and press feedback.",
      "Cards may use restrained depth or transform feedback when appropriate.",
      "Interactive motion must remain reversible and predictable.",
      "Never move a critical control away from the pointer during interaction."
    ],

    scroll: [
      "Use scroll motion only when it improves storytelling or hierarchy.",
      "Prefer section-level choreography over dozens of unrelated reveals.",
      "Never hijack scrolling.",
      "Avoid excessive parallax and scroll-linked decoration."
    ],

    media: [
      "Photography may use controlled crop or scale transitions when compositionally useful.",
      "Never destroy subject framing during animation.",
      "Preserve text-safe areas and intended focal points.",
      "Avoid decorative image motion that fights the layout."
    ],

    performance: [
      "Prefer transform and opacity.",
      "Avoid layout-thrashing animation.",
      "Avoid unnecessary infinite animation loops.",
      "Motion must not delay interaction readiness.",
      "Keep effects performant on mobile hardware."
    ],

    reducedMotion: [
      "Honor prefers-reduced-motion.",
      "Disable non-essential transforms, parallax and looping animation.",
      "Keep content immediately visible and interactions understandable.",
      "Reduced motion must never remove information."
    ],

    prohibited: [
      "No cheesy bounce animation.",
      "No random floating particles.",
      "No gratuitous glowing objects.",
      "No animation on every element.",
      "No motion that causes cumulative layout shift.",
      "No fake loading sequences.",
      "No generic gaming montage effects.",
      "No animation merely to make the page look busy."
    ]
  };
}

export function motionDirectorContext(
  plan: MotionDirectorPlan
): string {
  return [
    "VEYRA MOTION DIRECTOR",
    "",
    `Motion intensity: ${plan.intensity}`,
    `Philosophy: ${plan.philosophy}`,
    "",
    JSON.stringify(plan, null, 2),
    "",
    "Implement motion only when it materially improves hierarchy, interaction or storytelling.",
    "The static composition must remain strong when all motion is disabled."
  ].join("\n");
}
