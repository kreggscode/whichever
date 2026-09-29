import { getToken } from "./auth.js";
import { GEN_BASE, IMAGE_MODEL, IMAGE_SIZE, MAX_REPLY_CHARS, TEXT_MODEL } from "./config.js";
import { extractJson } from "./story.js";

export class ApiError extends Error {
    readonly status?: number;

    constructor(message: string, status?: number) {
        super(message);
        this.status = status;
    }
}

const authorized = () => {
    const token = getToken();
    if (!token) throw new ApiError("Sign in with your Pollen to let Jev decide.", 401);
    return {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
    };
};

const describe = async (response: Response): Promise<string> => {
    try {
        const body = (await response.json()) as { error?: { message?: string } };
        if (body.error?.message) return body.error.message;
    } catch {
        /* fall through to the status line */
    }
    return `Pollinations responded with ${response.status}.`;
};

/** Write the candidate turns. The reply is prose-wrapped JSON; keep it raw. */
export const proposeTurns = async (system: string, user: string): Promise<string> => {
    const response = await fetch(`${GEN_BASE}/v1/chat/completions`, {
        method: "POST",
        headers: authorized(),
        body: JSON.stringify({
            model: TEXT_MODEL,
            temperature: 0.9,
            messages: [
                { role: "system", content: system },
                { role: "user", content: user },
            ],
        }),
    });
    if (!response.ok) throw new ApiError(await describe(response), response.status);

    const payload = (await response.json()) as {
        choices?: { message?: { content?: unknown } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
        throw new ApiError("No turns could be written. Try again.");
    }
    return content.slice(0, MAX_REPLY_CHARS);
};

/**
 * Ask Jev. This is the endpoint the whole app exists for: `state` and a map
 * of typed questions in, `answers` back — a choice, a score and a yes/no
 * probability, each with its confidence.
 */
export const decide = async (request: unknown): Promise<unknown> => {
    const response = await fetch(`${GEN_BASE}/alpha/decisions`, {
        method: "POST",
        headers: authorized(),
        body: JSON.stringify(request),
    });
    if (!response.ok) throw new ApiError(await describe(response), response.status);

    try {
        return await response.json();
    } catch {
        throw new ApiError("Jev did not answer. Ask again.");
    }
};

/**
 * Paint the branch Jev chose. `reference` is the previous plate, and it is the
 * whole trick: the model copies its look, so one story stays one world instead
 * of six unrelated pictures.
 */
export const generateImage = async (prompt: string, reference?: string): Promise<string> => {
    const response = await fetch(`${GEN_BASE}/v1/images/generations`, {
        method: "POST",
        headers: authorized(),
        body: JSON.stringify({
            prompt,
            model: IMAGE_MODEL,
            size: IMAGE_SIZE,
            n: 1,
            response_format: "url",
            ...(reference ? { image: [reference] } : {}),
        }),
    });
    if (!response.ok) throw new ApiError(await describe(response), response.status);

    const payload = (await response.json()) as {
        data?: { url?: unknown }[];
    };
    const url = payload.data?.[0]?.url;
    if (typeof url !== "string" || !url.startsWith("https://")) {
        throw new ApiError("That plate did not develop. Take the turn again.");
    }
    return url;
};

/** Model replies arrive wrapped in prose or fences; the caller wants data. */
export const parseJson = <T,>(raw: string): T => {
    try {
        return extractJson(raw) as T;
    } catch {
        throw new ApiError("That came back as gibberish. Try again.");
    }
};
