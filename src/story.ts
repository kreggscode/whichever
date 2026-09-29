/**
 * The story itself: the turns the text model proposes, the verdict Jev returns
 * on them, and the request that gets that verdict. Nothing here touches the
 * network, so a whole decision can be tested without spending a single Pollen.
 */

import { CANDIDATES, DECISION_MODEL, MAX_PROMPT_CHARS, MAX_PREMISE_CHARS } from "./config.js";

/**
 * What the text model is asked before it proposes turns. The shape of the
 * reply is the contract the whole game is built on, so it lives with the rest
 * of the game's rules rather than with the UI that consumes it.
 */
export const PROPOSALS_SYSTEM = `You write the next moment of a story as three candidate branches.

Reply with ONLY a JSON object, no prose and no code fences:
{"candidates":[{"label":"short name for the turn, 2 to 5 words","text":"what happens, two sentences, 45 to 90 words","imagePrompt":"the picture of the moment AFTER this happens, 20 to 30 words of concrete visual detail"}]}

Write exactly three candidates. They must be genuinely different turns of events, not three phrasings of one event.
Each must be something that could plausibly happen next given what has already happened.
Never contradict what the story has already established about who it follows, what they want, or what has happened.
imagePrompt describes only the scene: where the point of view character is, what is visible, the light and the weather. Never put text, captions, words or letters in the picture.`;

/** One candidate turn, before anyone has judged it. */
export type Candidate = { key: string; label: string; text: string; imagePrompt: string };

/**
 * Jev's answer, flattened into the three shapes the endpoint returns: which
 * branch it picked and how sure, how tense the turn is, and whether the
 * original goal survived it.
 */
export type Judgement = {
    pick: string;
    confidence: number;
    probabilities: Record<string, number>;
    tension: number;
    rung: string;
    legend: string[];
    goalRisk: number;
};

/** One turn that has been judged and drawn. */
export type Chapter = { label: string; text: string; url: string };

export type Story = {
    premise: string;
    lensId: string;
    lensText: string;
    artId: string;
    chapters: Chapter[];
};

export const emptyStory = (): Story => ({
    premise: "",
    lensId: "change",
    lensText: "",
    artId: "watercolour",
    chapters: [],
});

const KEYS = ["a", "b", "c", "d", "e"];

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);

const clamp = (value: number, low: number, high: number): number =>
    Math.min(high, Math.max(low, value));

const trimTo = (text: string, limit: number): string =>
    text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;

/**
 * Pull the first JSON value out of a model reply. Models like to wrap answers
 * in prose or fence them with backticks, and neither should reach the caller.
 */
export const extractJson = (raw: string): unknown => {
    const unwrapped = raw
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/, "")
        .trim();
    const start = unwrapped.search(/[[{]/);
    if (start < 0) throw new Error("no JSON in the reply");

    const opener = unwrapped[start];
    const closer = opener === "{" ? "}" : "]";
    const end = unwrapped.lastIndexOf(closer);
    if (end <= start) throw new Error("unterminated JSON in the reply");

    return JSON.parse(unwrapped.slice(start, end + 1));
};

/**
 * Turn the text model's reply into turns that can actually be judged. Returns
 * null when the reply cannot be trusted — a malformed branch sends Jev a
 * question about nothing and the story stalls anyway.
 */
export const parseCandidates = (raw: string): Candidate[] | null => {
    let decoded: unknown;
    try {
        decoded = extractJson(raw);
    } catch {
        return null;
    }

    const list = Array.isArray(decoded)
        ? decoded
        : typeof decoded === "object" && decoded !== null && "candidates" in decoded
          ? (decoded as { candidates: unknown }).candidates
          : null;
    if (!Array.isArray(list)) return null;

    const candidates: Candidate[] = [];
    for (const entry of list) {
        if (typeof entry !== "object" || entry === null) continue;
        const record = entry as Record<string, unknown>;
        const label = record.label ?? record.title;
        const text = record.text ?? record.description;
        const imagePrompt = record.imagePrompt ?? record.image_prompt ?? record.prompt;
        if (typeof label !== "string" || label.trim() === "") continue;
        if (typeof text !== "string" || text.trim() === "") continue;
        if (typeof imagePrompt !== "string" || imagePrompt.trim() === "") continue;

        candidates.push({
            key: KEYS[candidates.length] ?? String(candidates.length),
            label: label.trim().slice(0, 60),
            text: text.trim().slice(0, 700),
            imagePrompt: imagePrompt.trim().slice(0, 320),
        });
        if (candidates.length === CANDIDATES) break;
    }

    return candidates.length === CANDIDATES ? candidates : null;
};

/** Jev's three questions about a turn. Each is answered independently. */
export const decisionQuestions = (story: Story, candidates: Candidate[]): Record<string, unknown> => ({
    branch: {
        type: "choice",
        instructions: story.lensText,
        criteria: Object.fromEntries(
            candidates.map((candidate) => [candidate.key, `${candidate.label}: ${candidate.text}`]),
        ),
    },
    tension: {
        type: "score",
        instructions: "How much does this turn raise the danger, cost or pressure on the protagonist?",
        criteria: ["quiet", "uneasy", "urgent", "dire"],
    },
    goalAtRisk: {
        type: "noul",
        instructions: "Does this turn put the protagonist's original goal out of reach?",
    },
});

/** The facts Jev decides on. The lens goes in `instructions`, not here. */
export const decisionState = (story: Story): string =>
    [
        `Premise: ${trimTo(story.premise.trim(), MAX_PREMISE_CHARS)}`,
        story.chapters.length > 0
            ? `Story so far:\n${story.chapters
                  .map((chapter, index) => `${index + 1}. ${chapter.label} — ${chapter.text}`)
                  .join("\n")}`
            : "This is the opening turn; nothing has happened yet.",
    ].join("\n\n");

/** The exact body posted to `POST /alpha/decisions`. */
export const decisionRequest = (story: Story, candidates: Candidate[]): unknown => ({
    model: DECISION_MODEL,
    state: decisionState(story),
    questions: decisionQuestions(story, candidates),
});

/** Legend arrives as an object keyed by rung index; the UI wants an array. */
const legendOf = (value: unknown): string[] | null => {
    if (Array.isArray(value)) {
        const rungs = value.filter((entry): entry is string => typeof entry === "string");
        return rungs.length > 0 ? rungs : null;
    }
    if (typeof value !== "object" || value === null) return null;

    const record = value as Record<string, unknown>;
    const rungs = Object.keys(record)
        .filter((key) => /^\d+$/.test(key))
        .sort((left, right) => Number(left) - Number(right))
        .map((key) => record[key]);
    if (rungs.length === 0 || !rungs.every((rung) => typeof rung === "string")) return null;
    return rungs as string[];
};

const probabilitiesOf = (value: unknown): Record<string, number> | null => {
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [key, entry] of Object.entries(record)) {
        if (!isFiniteNumber(entry)) return null;
        out[key] = entry;
    }
    return out;
};

const argMax = (probabilities: Record<string, number>): string | null => {
    let best: string | null = null;
    for (const [key, value] of Object.entries(probabilities)) {
        if (best === null || value > probabilities[best]) best = key;
    }
    return best;
};

/**
 * Read Jev's reply. Returns null when it does not carry a decision for the
 * branches that were actually offered — a pick for some other key would send
 * the story down a turn nobody wrote.
 */
export const parseJudgement = (payload: unknown, candidates: Candidate[]): Judgement | null => {
    if (typeof payload !== "object" || payload === null) return null;
    const answers = (payload as { answers?: unknown }).answers;
    if (typeof answers !== "object" || answers === null) return null;
    const bag = answers as Record<string, unknown>;

    const branch = bag.branch as Record<string, unknown> | undefined;
    const pick = branch?.choice;
    const keys = candidates.map((candidate) => candidate.key);
    if (typeof pick !== "string" || !keys.includes(pick)) return null;
    const probabilities = probabilitiesOf(branch?.probabilities);
    if (!probabilities || !keys.every((key) => isFiniteNumber(probabilities[key]))) return null;

    const tension = bag.tension as Record<string, unknown> | undefined;
    const score = tension?.score;
    if (!isFiniteNumber(score)) return null;
    const legend = legendOf(tension?.legend) ?? ["quiet", "uneasy", "urgent", "dire"];

    const answerProbabilities = probabilitiesOf(tension?.probabilities) ?? {};
    const modal = argMax(answerProbabilities);
    const rung =
        modal !== null && Number(modal) >= 0 && Number(modal) < legend.length
            ? legend[Number(modal)]
            : legend[clamp(Math.round(score), 0, legend.length - 1)];

    const risk = bag.goalAtRisk as Record<string, unknown> | undefined;
    const goalRisk = risk?.noul;
    if (!isFiniteNumber(goalRisk)) return null;

    return {
        pick,
        confidence: isFiniteNumber(branch?.confidence) ? branch.confidence : 1,
        probabilities: Object.fromEntries(keys.map((key) => [key, probabilities[key]])),
        tension: clamp(score, 0, legend.length - 1),
        rung,
        legend,
        goalRisk: clamp(goalRisk, 0, 1),
    };
};

/** How sure Jev is, as a percentage the UI can draw without doing sums. */
export const asPercent = (value: number): number => Math.round(clamp(value, 0, 1) * 100);

/** The tension meter is a fraction of the whole scale, not of the rung count. */
export const tensionFill = (judgement: Judgement): number =>
    judgement.legend.length > 1
        ? clamp(judgement.tension / (judgement.legend.length - 1), 0, 1)
        : 0;

/**
 * The prompt that paints a branch. The reference image is what keeps one
 * chapter looking like the last; the words only carry the place.
 */
export const chapterPrompt = (candidate: Candidate, suffix: string): string =>
    trimTo(`${candidate.imagePrompt.trim()}, ${suffix}`, MAX_PROMPT_CHARS);
