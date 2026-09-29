/** Every endpoint, model and credential the app talks to. */

export const GEN_BASE = "https://gen.pollinations.ai";
export const ENTER_BASE = "https://enter.pollinations.ai";

/**
 * Publishable App Key (`pk_...`) for Bring Your Own Pollen. It identifies the
 * app on the consent screen; the spend is always the player's own Pollen.
 * Overridable at build time so the key never has to live in git history.
 */
export const CLIENT_ID: string =
    (import.meta.env.VITE_POLLINATIONS_CLIENT_ID as string | undefined) ?? "";

/** OAuth redirect target — must match a Redirect URI registered on the App Key. */
export const REDIRECT_URI: string =
    (import.meta.env.VITE_POLLINATIONS_REDIRECT_URI as string | undefined) ??
    (typeof window === "undefined"
        ? ""
        : `${window.location.origin}${window.location.pathname}`);

/**
 * Writes the three candidate turns. Free, cheap, and answers in the JSON the
 * rest of the game is built on.
 */
export const TEXT_MODEL = "openai/gpt-5.4-nano";

/**
 * Picks between them. Typed answers — a choice, a score, a yes/no probability —
 * rather than free text, which is the whole reason it is worth calling.
 */
export const DECISION_MODEL = "jev";

/**
 * Paints the branch Jev chose. Free, takes exactly one reference image, and
 * answers in around half a minute — fast enough that a story keeps moving.
 */
export const IMAGE_MODEL = "microsoft/mai-image-2.6-flash";

/** Square reads best as a plate in the story. */
export const IMAGE_SIZE = "1024x1024";

/** Candidates per turn: enough to be a real choice, few enough to read at a glance. */
export const CANDIDATES = 3;

/** A story earns an ending. Six turns is a story, not an expense. */
export const MAX_CHAPTERS = 6;

export const MAX_PREMISE_CHARS = 400;
export const MAX_LENS_CHARS = 160;

/** Text replies are one small object; anything longer is a broken reply. */
export const MAX_REPLY_CHARS = 4_000;

/** Prompts are capped rather than allowed to grow with every chapter. */
export const MAX_PROMPT_CHARS = 600;

/**
 * What Jev is asked to optimise for. The player's real control: they never
 * pick the branch, they pick the standard the branch is judged against.
 */
export type Lens = { id: string; name: string; text: string };

export const LENSES: readonly Lens[] = [
    {
        id: "change",
        name: "Changes what they want",
        text: "the branch that most changes what the protagonist wants next",
    },
    {
        id: "danger",
        name: "Most dangerous",
        text: "the branch that puts the protagonist in the most immediate danger",
    },
    {
        id: "irreversible",
        name: "Most irreversible",
        text: "the branch that cannot be undone, whatever happens after it",
    },
    {
        id: "wonder",
        name: "Most wondrous",
        text: "the branch that reveals something the protagonist could not have imagined",
    },
    {
        id: "kind",
        name: "Kindest",
        text: "the branch that costs the protagonist least and helps somebody else most",
    },
    {
        id: "funny",
        name: "Funniest",
        text: "the branch that goes most wrong for the funniest reason",
    },
];

export const lensById = (id: string): Lens =>
    LENSES.find((lens) => lens.id === id) ?? LENSES[0];

/** How the drawn branch looks, so the first plate sets the tone. */
export type Art = { id: string; name: string; suffix: string };

export const ART: readonly Art[] = [
    {
        id: "watercolour",
        name: "Watercolour",
        suffix: "watercolour painting on cold-press paper, deckled edge, soft muted palette",
    },
    {
        id: "ink",
        name: "Ink and wash",
        suffix: "ink and wash drawing, fine pen hatching, restrained washes",
    },
    {
        id: "riso",
        name: "Risograph",
        suffix: "risograph print, limited spot colours, coarse halftone",
    },
    {
        id: "woodcut",
        name: "Woodcut",
        suffix: "woodcut print, bold carved lines, flat ink, visible grain",
    },
    {
        id: "nocturne",
        name: "Nocturne",
        suffix: "nocturne painting, deep blues, a single warm light source",
    },
];

export const artById = (id: string): Art =>
    ART.find((art) => art.id === id) ?? ART[0];
