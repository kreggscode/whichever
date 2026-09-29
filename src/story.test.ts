import { describe, expect, it } from "vitest";
import { CANDIDATES, DECISION_MODEL, MAX_PROMPT_CHARS } from "./config.js";
import {
    PROPOSALS_SYSTEM,
    asPercent,
    chapterPrompt,
    decisionRequest,
    decisionState,
    emptyStory,
    extractJson,
    parseCandidates,
    parseJudgement,
    tensionFill,
    type Candidate,
    type Story,
} from "./story.js";

const turns = `{"candidates":[
    {"label":"board the ferry","text":"Ink boards the crowded ferry and pays with the last of the coin.","imagePrompt":"Ink stands at the ferry rail, the market going under behind, grey rain"},
    {"label":"the drowned arcade","text":"Ink wades the flooded arcade beneath the old exchange.","imagePrompt":"A figure wades a flooded arcade, arches reflected in black water"},
    {"label":"burn the letter","text":"Ink decides the coast can wait and burns the sealed letter.","imagePrompt":"A sealed letter curling to ash in a brazier, dusk light on wet stone"}
]}`;

const candidates = (): Candidate[] => parseCandidates(turns) as Candidate[];

const story = (): Story => ({
    ...emptyStory(),
    premise: "a courier with a sealed letter that must reach the coast",
    lensId: "change",
    lensText: "the branch that most changes what the protagonist wants next",
    artId: "watercolour",
    chapters: [],
});

/** Shaped exactly like the response `POST /alpha/decisions` returned in the probe. */
const verdict = {
    answers: {
        branch: {
            type: "choice",
            choice: "b",
            probabilities: { a: 0.1, b: 0.8, c: 0.1 },
            confidence: 0.8,
        },
        tension: {
            type: "score",
            score: 2.17,
            legend: { "0": "quiet", "1": "uneasy", "2": "urgent", "3": "dire" },
            probabilities: { "0": 0, "1": 0, "2": 0.82, "3": 0.18 },
            confidence: 0.82,
        },
        goalAtRisk: { type: "noul", noul: 0.6 },
    },
    usage: { input_tokens: 366, output_tokens: 48 },
};

describe("extractJson", () => {
    it("reads a bare object", () => {
        expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    });

    it("reads a reply fenced as json", () => {
        expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    });

    it("reads a reply buried in prose", () => {
        expect(extractJson('Sure! Here you go: {"a":1} — hope that helps.')).toEqual({ a: 1 });
    });

    it("throws when there is nothing to read", () => {
        expect(() => extractJson("I could not work it out.")).toThrow();
    });

    it("throws on truncated json", () => {
        expect(() => extractJson('{"candidates":[{"label":"a"')).toThrow();
    });
});

describe("parseCandidates", () => {
    it("turns a proposal into three judgeable turns", () => {
        const written = parseCandidates(turns);
        expect(written).not.toBeNull();
        expect(written).toHaveLength(CANDIDATES);
        expect(written?.[0]).toMatchObject({
            key: "a",
            label: "board the ferry",
            imagePrompt: "Ink stands at the ferry rail, the market going under behind, grey rain",
        });
    });

    it("reads a fenced reply", () => {
        expect(parseCandidates(`\`\`\`json\n${turns}\n\`\`\``)).toHaveLength(CANDIDATES);
    });

    it("keys the turns by position, whatever the model called them", () => {
        const oddKeys = turns.replace('"label":"board', '"key":"zeta","label":"board');
        expect(parseCandidates(oddKeys)?.map((candidate) => candidate.key)).toEqual(["a", "b", "c"]);
    });

    it("refuses a reply with fewer turns than the game promises", () => {
        const two = `{"candidates":[
            {"label":"a","text":"one","imagePrompt":"a road"},
            {"label":"b","text":"two","imagePrompt":"a gate"}]}`;
        expect(parseCandidates(two)).toBeNull();
    });

    it("refuses a reply that is not a list of turns", () => {
        expect(parseCandidates("Three things could happen next.")).toBeNull();
        expect(parseCandidates('{"turns":[]}')).toBeNull();
        expect(parseCandidates("[]")).toBeNull();
    });

    it("drops entries missing the things a turn needs", () => {
        const mixed = `{"candidates":[
            {"label":"","text":"a","imagePrompt":"x"},
            {"label":"no text","imagePrompt":"x"},
            {"label":"no picture","text":"a"},
            {"label":"one","text":"a","imagePrompt":"x"},
            {"label":"two","text":"b","imagePrompt":"y"},
            {"label":"three","text":"c","imagePrompt":"z"}]}`;
        const written = parseCandidates(mixed);
        expect(written).toHaveLength(CANDIDATES);
        expect(written?.map((candidate) => candidate.label)).toEqual(["one", "two", "three"]);
    });

    it("refuses a reply where nothing usable survived", () => {
        const allBad = `{"candidates":[
            {"label":"","text":"","imagePrompt":""},
            {"label":"a","text":"","imagePrompt":"x"}]}`;
        expect(parseCandidates(allBad)).toBeNull();
    });
});

describe("the decision Jev is asked for", () => {
    it("posts the model, the facts and three typed questions", () => {
        const request = decisionRequest(story(), candidates()) as Record<string, unknown>;
        expect(request.model).toBe(DECISION_MODEL);
        expect(String(request.state)).toContain("a courier with a sealed letter");

        const questions = request.questions as Record<string, { type: string }>;
        expect(questions.branch.type).toBe("choice");
        expect(questions.tension.type).toBe("score");
        expect(questions.goalAtRisk.type).toBe("noul");
    });

    it("offers exactly the turns on the table", () => {
        const request = decisionRequest(story(), candidates()) as {
            questions: { branch: { instructions: string; criteria: Record<string, string> } };
        };
        expect(Object.keys(request.questions.branch.criteria)).toEqual(["a", "b", "c"]);
        expect(request.questions.branch.criteria.a).toContain("board the ferry");
        expect(request.questions.branch.instructions).toBe(
            "the branch that most changes what the protagonist wants next",
        );
    });

    it("names the tension scale Jev scores against", () => {
        const request = decisionRequest(story(), candidates()) as {
            questions: { tension: { criteria: string[] } };
        };
        expect(request.questions.tension.criteria).toEqual(["quiet", "uneasy", "urgent", "dire"]);
    });

    it("carries the premise and every chapter into the state", () => {
        const withChapters: Story = {
            ...story(),
            chapters: [{ label: "burn the letter", text: "Ink let it go to ash.", url: "https://media.pollinations.ai/x" }],
        };
        const state = decisionState(withChapters);
        expect(state).toContain("Premise: a courier with a sealed letter");
        expect(state).toContain("Story so far:");
        expect(state).toContain("1. burn the letter — Ink let it go to ash.");
    });

    it("says out loud when nothing has happened yet", () => {
        expect(decisionState(story())).toContain("This is the opening turn");
    });
});

describe("parseJudgement", () => {
    it("reads the choice, the score and the yes/no out of one reply", () => {
        const read = parseJudgement(verdict, candidates());
        expect(read).not.toBeNull();
        expect(read).toMatchObject({
            pick: "b",
            confidence: 0.8,
            probabilities: { a: 0.1, b: 0.8, c: 0.1 },
            tension: 2.17,
            rung: "urgent",
            legend: ["quiet", "uneasy", "urgent", "dire"],
            goalRisk: 0.6,
        });
    });

    it("reads a legend given as an array as well as an object", () => {
        const asArray = {
            answers: {
                ...verdict.answers,
                tension: { ...verdict.answers.tension, legend: ["quiet", "uneasy", "urgent", "dire"] },
            },
        };
        expect(parseJudgement(asArray, candidates())?.rung).toBe("urgent");
    });

    it("reads the rung off the probabilities, not off a rounding guess", () => {
        const tied = {
            answers: {
                ...verdict.answers,
                tension: {
                    ...verdict.answers.tension,
                    score: 2.9,
                    probabilities: { "0": 0, "1": 0.1, "2": 0.7, "3": 0.2 },
                },
            },
        };
        expect(parseJudgement(tied, candidates())?.rung).toBe("urgent");
    });

    it("refuses a pick that is not one of the turns offered", () => {
        const alien = { answers: { ...verdict.answers, branch: { ...verdict.answers.branch, choice: "q" } } };
        expect(parseJudgement(alien, candidates())).toBeNull();
    });

    it("refuses a reply that answers nothing", () => {
        expect(parseJudgement({ id: "dec-1" }, candidates())).toBeNull();
        expect(parseJudgement({}, candidates())).toBeNull();
        expect(parseJudgement("nope", candidates())).toBeNull();
        expect(parseJudgement(null, candidates())).toBeNull();
    });

    it("refuses a reply missing one of the three answers", () => {
        const withoutRisk = { answers: { ...verdict.answers, goalAtRisk: undefined } };
        expect(parseJudgement(withoutRisk, candidates())).toBeNull();
        const withoutTension = { answers: { ...verdict.answers, tension: { type: "score" } } };
        expect(parseJudgement(withoutTension, candidates())).toBeNull();
    });

    it("refuses probabilities that do not cover every turn", () => {
        const partial = {
            answers: { ...verdict.answers, branch: { ...verdict.answers.branch, probabilities: { a: 1 } } },
        };
        expect(parseJudgement(partial, candidates())).toBeNull();
    });
});

describe("what the verdict looks like on screen", () => {
    const read = parseJudgement(verdict, candidates())!;

    it("turns a confidence into a percentage", () => {
        expect(asPercent(read.confidence)).toBe(80);
        expect(asPercent(0)).toBe(0);
        expect(asPercent(1.4)).toBe(100);
    });

    it("fills the tension meter against the whole scale, not the rung count", () => {
        expect(tensionFill(read)).toBeCloseTo(2.17 / 3, 5);
        expect(tensionFill(read)).toBeGreaterThan(0);
        expect(tensionFill(read)).toBeLessThan(1);
    });
});

describe("prompts", () => {
    it("paints a turn from its picture and the chosen art", () => {
        expect(chapterPrompt(candidates()[0], "risograph print")).toBe(
            "Ink stands at the ferry rail, the market going under behind, grey rain, risograph print",
        );
    });

    it("keeps a long picture from running away with the prompt", () => {
        const long = { ...candidates()[0], imagePrompt: "a very long scene ".repeat(200) };
        expect(chapterPrompt(long, "woodcut").length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    });

    it("asks for turns as json with no prose around them", () => {
        expect(PROPOSALS_SYSTEM).toContain('"candidates"');
        expect(PROPOSALS_SYSTEM).toContain("no code fences");
        expect(PROPOSALS_SYSTEM).toContain("exactly three candidates");
    });
});
