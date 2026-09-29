import { beforeAll, describe, expect, it } from "vitest";
import { ApiError, decide, generateImage, proposeTurns } from "./api.js";
import {
    PROPOSALS_SYSTEM,
    chapterPrompt,
    decisionRequest,
    emptyStory,
    parseCandidates,
    parseJudgement,
    type Story,
} from "./story.js";

const KEY = process.env.POLLINATIONS_API_KEY ?? "";

// `auth.ts` reads sessionStorage when a call is made; Node has none.
const store = new Map<string, string>();
(globalThis as unknown as Record<string, unknown>).sessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
};

const story: Story = {
    ...emptyStory(),
    premise: "a courier with a sealed letter that must reach the coast before the tide closes the road",
    lensId: "change",
    lensText: "the branch that most changes what the protagonist wants next",
    artId: "watercolour",
    chapters: [],
};

beforeAll(() => {
    if (KEY) store.set("whichever.token", KEY);
});

describe.skipIf(!KEY)("a chapter, against the live endpoints", () => {
    let turns = "";
    let url = "";

    it("writes three candidate turns", async () => {
        const reply = await proposeTurns(PROPOSALS_SYSTEM, `Premise: ${story.premise}\nWrite exactly 3 candidate next turns.`);
        turns = reply;
        const candidates = parseCandidates(reply);
        expect(candidates).not.toBeNull();
        expect(candidates).toHaveLength(3);
        for (const candidate of candidates!) {
            expect(candidate.label.length).toBeGreaterThan(0);
            expect(candidate.text.length).toBeGreaterThan(20);
            expect(candidate.imagePrompt.length).toBeGreaterThan(10);
        }
    }, 120_000);

    it("hands them to Jev, which picks one", async () => {
        const candidates = parseCandidates(turns);
        expect(candidates).not.toBeNull();

        const payload = await decide(decisionRequest(story, candidates!));
        const verdict = parseJudgement(payload, candidates!);
        expect(verdict).not.toBeNull();
        expect(["a", "b", "c"]).toContain(verdict!.pick);
        expect(verdict!.confidence).toBeGreaterThan(0);
        expect(verdict!.goalRisk).toBeGreaterThanOrEqual(0);
        expect(verdict!.goalRisk).toBeLessThanOrEqual(1);
        expect(verdict!.legend.length).toBeGreaterThan(1);
        // Every probability is reported, and they are a distribution over the turns.
        const total = Object.values(verdict!.probabilities).reduce((sum, value) => sum + value, 0);
        expect(total).toBeCloseTo(1, 2);
    }, 120_000);

    it("draws the turn Jev chose", async () => {
        const candidates = parseCandidates(turns);
        const chosen = candidates!.find((candidate) => candidate.key === "b") ?? candidates![0];
        url = await generateImage(chapterPrompt(chosen, "watercolour painting on cold-press paper"));
        expect(url).toMatch(/^https:\/\/media\.pollinations\.ai\//);
    }, 240_000);

    it("draws the next turn in the same look, using the last as a reference", async () => {
        expect(url).not.toBe("");
        const candidates = parseCandidates(turns);
        const other = candidates!.find((candidate) => candidate.key !== "b") ?? candidates![1];
        const second = await generateImage(chapterPrompt(other, "watercolour painting on cold-press paper"), url);
        expect(second).toMatch(/^https:\/\/media\.pollinations\.ai\//);
        expect(second).not.toBe(url);
    }, 240_000);
});

describe("sign-in is required", () => {
    it("raises an ApiError before any request goes out", async () => {
        const previous = store.get("whichever.token");
        store.delete("whichever.token");
        const error = await generateImage("nowhere").catch((caught: unknown) => caught);
        store.set("whichever.token", previous ?? "");
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(401);
    });

    it("raises it for the decision endpoint too", async () => {
        const previous = store.get("whichever.token");
        store.delete("whichever.token");
        const error = await decide(decisionRequest(story, [])).catch((caught: unknown) => caught);
        store.set("whichever.token", previous ?? "");
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(401);
    });
});
