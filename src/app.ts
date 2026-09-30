import { ApiError, decide, generateImage, proposeTurns } from "./api.js";
import { beginAuthorization, completeAuthorization, isSignedIn } from "./auth.js";
import {
    ART,
    CANDIDATES,
    LENSES,
    MAX_CHAPTERS,
    artById,
    lensById,
    type Lens,
} from "./config.js";
import { button, clear, h, on } from "./dom.js";
import {
    PROPOSALS_SYSTEM,
    asPercent,
    chapterPrompt,
    decisionRequest,
    emptyStory,
    parseCandidates,
    parseJudgement,
    tensionFill,
    type Candidate,
    type Judgement,
    type Story,
} from "./story.js";

type Screen = "start" | "decide" | "scene" | "end";

let screen: Screen = "start";
let story: Story = emptyStory();
let candidates: Candidate[] = [];
let judgement: Judgement | null = null;
let premiseDraft = "";
let lensId = LENSES[0].id;
let customLens = "";
let artId = ART[0].id;
let busy = false;
let busyLabel = "";
let errorMessage = "";

const root = () => document.getElementById("app") as HTMLElement;

const trimTo = (text: string, limit: number): string =>
    text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;

const messageOf = (error: unknown): string =>
    error instanceof ApiError ? error.message : "Something went wrong. Try again.";

const stage = (label: string): void => {
    busyLabel = label;
    render();
};

const run = async (label: string, work: () => Promise<void>): Promise<void> => {
    if (busy) return;
    busy = true;
    busyLabel = label;
    errorMessage = "";
    render();
    try {
        await work();
    } catch (error) {
        errorMessage = messageOf(error);
    } finally {
        busy = false;
        busyLabel = "";
        render();
    }
};

/** The lens actually in force: a typed one beats whichever chip was last hit. */
const activeLensText = (): string => customLens.trim() || lensById(lensId).text;

const activeLensName = (): string =>
    customLens.trim() !== "" && story.lensText === customLens.trim()
        ? trimTo(customLens.trim(), 46)
        : lensById(story.lensId).name;

/* ---------------------------------------------------------------- the work */

const proposalUser = (current: Story): string =>
    [
        `Premise: ${current.premise}`,
        current.chapters.length === 0
            ? "This is the opening turn; nothing has happened yet."
            : `Story so far:\n${current.chapters
                  .map((chapter, index) => `${index + 1}. ${chapter.label} — ${chapter.text}`)
                  .join("\n")}`,
        `Write exactly ${CANDIDATES} candidate next turns.`,
    ].join("\n\n");

/** Ask the text model for the next three turns, then ask Jev to judge them. */
const writeTurns = async (): Promise<void> => {
    stage("Writing three turns…");
    const written = parseCandidates(await proposeTurns(PROPOSALS_SYSTEM, proposalUser(story)));
    if (!written) throw new ApiError("No turns could be written from that. Try again.");
    candidates = written;
    await judgeTurn();
};

/** Hand the three turns to Jev, along with the lens they are judged against. */
const judgeTurn = async (): Promise<void> => {
    stage("Jev is deciding…");
    const verdict = parseJudgement(await decide(decisionRequest(story, candidates)), candidates);
    if (!verdict) throw new ApiError("Jev did not pick one of those turns. Ask again.");
    judgement = verdict;
};

/** Draw the turn Jev chose and file it as the next chapter. */
const takeTurn = async (): Promise<void> => {
    const verdict = judgement;
    const chosen = verdict ? candidates.find((candidate) => candidate.key === verdict.pick) : undefined;
    if (!verdict || !chosen) throw new ApiError("There is no decided turn to take yet.");

    stage("Painting the branch Jev chose…");
    const previous = story.chapters[story.chapters.length - 1];
    const url = await generateImage(
        chapterPrompt(chosen, artById(story.artId).suffix),
        previous?.url,
    );

    story = {
        ...story,
        chapters: [...story.chapters, { label: chosen.label, text: chosen.text, url }],
    };
    candidates = [];
    judgement = null;
    screen = story.chapters.length >= MAX_CHAPTERS ? "end" : "scene";
};

/* --------------------------------------------------------------- commands */

const begin = () => {
    const premise = premiseDraft.trim();
    if (!premise) {
        errorMessage = "Type where the story starts.";
        render();
        return;
    }
    story = { ...emptyStory(), premise, lensId, lensText: activeLensText(), artId };
    candidates = [];
    judgement = null;
    errorMessage = "";
    screen = "decide";
    return run("Writing three turns…", writeTurns).then(() => {
        // A story that never got its first turn belongs back on the start card.
        if (candidates.length === 0 && story.chapters.length === 0) {
            screen = "start";
            render();
        }
    });
};

const nextChapter = () => {
    screen = "decide";
    return run("Writing three turns…", writeTurns);
};

/** Re-run the verdict only. The turns stay; the standard they are judged by does not. */
const relens = (lens: Lens) => {
    lensId = lens.id;
    customLens = "";
    story = { ...story, lensId: lens.id, lensText: lens.text };
    return run("Jev is deciding…", judgeTurn);
};

const take = () => (judgement ? run("Painting the branch Jev chose…", takeTurn) : undefined);

const finish = () => {
    screen = "end";
    errorMessage = "";
    render();
};

const reset = () => {
    story = emptyStory();
    candidates = [];
    judgement = null;
    lensId = LENSES[0].id;
    customLens = "";
    artId = ART[0].id;
    errorMessage = "";
    screen = "start";
    render();
};

/* ------------------------------------------------------------------ chrome */

const footer = () =>
    h(
        "footer",
        { class: "foot" },
        h(
            "p",
            {},
            "Powered by ",
            h("a", {
                href: "https://pollinations.ai",
                target: "_blank",
                rel: "noreferrer",
                text: "Pollinations",
            }),
            " · ",
            h("a", {
                href: "https://gen.pollinations.ai/docs",
                target: "_blank",
                rel: "noreferrer",
                text: "API docs",
            }),
            " · ",
            h("a", {
                href: "https://github.com/pollinations/pollinations/blob/main/BRING_YOUR_OWN_POLLEN.md",
                target: "_blank",
                rel: "noreferrer",
                text: "Bring your own Pollen",
            }),
        ),
    );

const heading = (title: string, sub: string) =>
    h(
        "header",
        { class: "head" },
        h("p", { class: "mark", text: "Whichever" }),
        h("h1", { text: title }),
        h("p", { class: "sub", text: sub }),
    );

const shell = (...nodes: (Node | null | false | undefined)[]) => {
    const node = root();
    clear(node);
    for (const child of nodes) if (child) node.appendChild(child);
    if (busy) node.appendChild(h("p", { class: "busy", text: busyLabel, role: "status" }));
    if (errorMessage) {
        node.appendChild(h("div", { id: "error", class: "error", text: errorMessage }));
    }
    node.appendChild(footer());
};

const signInBlock = () =>
    isSignedIn()
        ? h("p", { class: "signed", text: "Signed in — this story runs on your Pollen." })
        : button("Sign in with your Pollen", () => void beginAuthorization(), "ghost");

const chipRow = (
    items: readonly { id: string; name: string }[],
    current: string,
    label: string,
    pick: (id: string) => void,
) =>
    h(
        "div",
        { class: "chips", role: "group", "aria-label": label },
        ...items.map((item) =>
            on(
                h("button", {
                    class: `chip${item.id === current ? " picked" : ""}`,
                    type: "button",
                    disabled: busy,
                    "aria-pressed": String(item.id === current),
                    text: item.name,
                }),
                "click",
                () => pick(item.id),
            ),
        ),
    );

/* --------------------------------------------------------------- screens */

const renderStart = () =>
    shell(
        heading(
            "Jev picks. You set the lens.",
            "Type where the story starts and choose what it should be judged against. A text model writes three turns, Jev decides between them, and the one it picks is drawn.",
        ),
        h(
            "section",
            { class: "card" },
            signInBlock(),
            h(
                "label",
                { class: "field", for: "premise" },
                h("span", { text: "Where does it start?" }),
                h("textarea", {
                    id: "premise",
                    class: "premise",
                    rows: "4",
                    placeholder: "a courier with a sealed letter that must reach the coast before the tide closes the road",
                    text: premiseDraft,
                    oninput: (event: Event) => {
                        premiseDraft = (event.target as HTMLTextAreaElement).value;
                    },
                }),
            ),
            h(
                "div",
                { class: "block" },
                h("p", { class: "legend", text: "What should Jev optimise for?" }),
                chipRow(LENSES, lensId, "The lens Jev judges against", (id) => {
                    lensId = id;
                    customLens = "";
                    render();
                }),
                h(
                    "label",
                    { class: "field", for: "lens" },
                    h("span", { text: "Or write your own" }),
                    h("input", {
                        id: "lens",
                        class: "lensfield",
                        type: "text",
                        placeholder: "the branch that costs someone their reputation",
                        value: customLens,
                        oninput: (event: Event) => {
                            customLens = (event.target as HTMLInputElement).value;
                        },
                    }),
                ),
            ),
            h(
                "div",
                { class: "block" },
                h("p", { class: "legend", text: "How should it be drawn?" }),
                chipRow(ART, artId, "Art style", (id) => {
                    artId = id;
                    render();
                }),
            ),
            button("Let Jev decide", () => void begin(), "primary", busy),
            h("p", {
                class: "fine",
                text: `${CANDIDATES} candidates per turn, up to ${MAX_CHAPTERS} chapters, drawn on your own Pollen.`,
            }),
        ),
    );

const storyStrip = () =>
    h(
        "nav",
        { class: "trail", "aria-label": "Chapters so far" },
        ...story.chapters.map((chapter, index) =>
            h(
                "div",
                { class: `crumb${index === story.chapters.length - 1 ? " here" : ""}` },
                h("img", { src: chapter.url, alt: "", loading: "lazy" }),
                h("span", { class: "crumbnum", text: String(index + 1) }),
            ),
        ),
    );

const candidateCard = (candidate: Candidate, verdict: Judgement) => {
    const chosen = candidate.key === verdict.pick;
    const share = asPercent(verdict.probabilities[candidate.key] ?? 0);
    return h(
        "article",
        { class: `candidate${chosen ? " chosen" : ""}` },
        h(
            "div",
            { class: "candhead" },
            h("span", { class: "candlabel", text: candidate.label }),
            chosen
                ? h("span", { class: "badge", text: `Jev picked this · ${asPercent(verdict.confidence)}% sure` })
                : null,
        ),
        h("p", { class: "candtext", text: candidate.text }),
        h(
            "div",
            { class: "prob" },
            h(
                "span",
                { class: "probtrack" },
                h("span", { class: "probfill", style: `width:${share}%` }),
            ),
            h("span", { class: "probnum", text: `${share}%` }),
        ),
    );
};

const meter = (label: string, fill: number, verdict: string, detail: string) =>
    h(
        "div",
        { class: "meter" },
        h(
            "div",
            { class: "meterhead" },
            h("span", { class: "meterlabel", text: label }),
            h("span", { class: "meterval", text: verdict }),
        ),
        h(
            "div",
            { class: "metertrack" },
            h("span", { class: "meterfill", style: `width:${asPercent(fill)}%` }),
        ),
        h("p", { class: "fine", text: detail }),
    );

const verdictMeters = (verdict: Judgement) =>
    h(
        "div",
        { class: "meters" },
        meter(
            "Tension",
            tensionFill(verdict),
            verdict.rung,
            `Jev scored this turn ${verdict.tension.toFixed(2)} along ${verdict.legend.join(" → ")}`,
        ),
        meter(
            "Original goal",
            verdict.goalRisk,
            verdict.goalRisk >= 0.5 ? "out of reach" : "still reachable",
            `Jev put the probability that the goal is out of reach at ${asPercent(verdict.goalRisk)}%`,
        ),
    );

const lensRow = () =>
    h(
        "div",
        { class: "block" },
        h("p", { class: "legend", text: "Ask Jev again against a different lens:" }),
        chipRow(LENSES, customLens.trim() === "" ? story.lensId : "", "Judge against", (id) => {
            const lens = LENSES.find((entry) => entry.id === id);
            if (lens) void relens(lens);
        }),
    );

const renderDecide = () => {
    if (candidates.length === 0 || !judgement) {
        shell(
            heading(
                "The next turn did not write.",
                `Chapter ${story.chapters.length + 1} of ${MAX_CHAPTERS} · nothing was proposed for it.`,
            ),
            h(
                "section",
                { class: "card" },
                h("p", { class: "fine", text: "The story so far is intact — only this turn failed." }),
                h(
                    "div",
                    { class: "tools" },
                    button("Try again", () => void nextChapter(), "primary", busy),
                    story.chapters.length > 0
                        ? button("End the story", finish, "ghost", busy)
                        : button("Start over", reset, "ghost", busy),
                ),
            ),
        );
        return;
    }

    const verdict = judgement;
    shell(
        heading(
            "Which of these happens?",
            `Chapter ${story.chapters.length + 1} of ${MAX_CHAPTERS} · judged against: ${activeLensName()}`,
        ),
        story.chapters.length > 0 ? storyStrip() : null,
        lensRow(),
        h(
            "div",
            { class: "candidates", role: "group", "aria-label": "The turns Jev judged" },
            ...candidates.map((candidate) => candidateCard(candidate, verdict)),
        ),
        verdictMeters(verdict),
        h(
            "div",
            { class: "tools" },
            button("Take it", () => void take(), "primary", busy),
            story.chapters.length > 0
                ? button("End the story", finish, "ghost", busy)
                : button("Start over", reset, "ghost", busy),
        ),
    );
};

const renderScene = () => {
    const chapter = story.chapters[story.chapters.length - 1];
    if (!chapter) {
        reset();
        return;
    }
    const atEnd = story.chapters.length >= MAX_CHAPTERS;

    shell(
        heading(
            chapter.label,
            `Chapter ${story.chapters.length} of ${MAX_CHAPTERS} · ${artById(story.artId).name} · lens: ${activeLensName()}`,
        ),
        h("figure", { class: "scene" }, h("img", { src: chapter.url, alt: chapter.label })),
        h(
            "div",
            { class: "narrative" },
            ...story.chapters.map((beat) =>
                h("p", { class: "beat" }, h("strong", { text: `${beat.label}. ` }), beat.text),
            ),
        ),
        storyStrip(),
        atEnd
            ? h("p", { class: "fine", text: "Six chapters is a story. Read it through, or tell another." })
            : null,
        h(
            "div",
            { class: "tools" },
            atEnd
                ? button("Read it from the start", finish, "primary", busy)
                : button("Next chapter", () => void nextChapter(), "primary", busy),
            !atEnd ? button("End the story", finish, "ghost", busy) : null,
            button("Start over", reset, "ghost", busy),
        ),
        !isSignedIn() ? signInBlock() : null,
    );
};

const renderEnd = () =>
    shell(
        heading("The story, as Jev told it.", `${story.chapters.length} chapters · lens: ${activeLensName()}`),
        story.chapters.length === 0
            ? h("p", { class: "fine", text: "No turn was ever taken. Tell another." })
            : h(
                "div",
                { class: "pages" },
                h("blockquote", { class: "premise", text: story.premise }),
                ...story.chapters.map((beat) =>
                    h(
                        "article",
                        { class: "page" },
                        h("img", { src: beat.url, alt: beat.label }),
                        h("p", { class: "pagelabel", text: beat.label }),
                        h("p", { class: "pagetext", text: beat.text }),
                    ),
                ),
            ),
        h(
            "div",
            { class: "tools" },
            button("Tell another", reset, "primary", busy),
            !isSignedIn() ? signInBlock() : null,
        ),
    );

export const render = () => {
    if (screen === "decide") renderDecide();
    else if (screen === "scene") renderScene();
    else if (screen === "end") renderEnd();
    else renderStart();
};

/* ------------------------------------------------------------------ model */

/** Load, finish any sign-in round trip, then draw the first screen. */
export const boot = async (): Promise<void> => {
    await completeAuthorization();
    render();
};
