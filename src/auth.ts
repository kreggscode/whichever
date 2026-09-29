import { CLIENT_ID, ENTER_BASE, REDIRECT_URI } from "./config.js";

/**
 * Bring Your Own Pollen: the player authorizes this app to spend their own
 * Pollen through the OAuth authorization-code flow with PKCE, so the `sk_`
 * key never travels in a URL and the app never holds a shared secret.
 *
 * The token lives in sessionStorage — same tab, survives a reload, never in
 * localStorage, a query string, or a log line.
 */

const VERIFIER_KEY = "whichever.pkce.verifier";
const STATE_KEY = "whichever.pkce.state";
const TOKEN_KEY = "whichever.token";
const TOKEN_EXPIRES_KEY = "whichever.token.expires";

const base64url = (bytes: Uint8Array): string =>
    btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

const randomString = (length: number): string => {
    const alphabet =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
};

export const getToken = (): string | null => {
    const expires = Number(sessionStorage.getItem(TOKEN_EXPIRES_KEY) ?? 0);
    if (expires && Date.now() > expires) {
        clearToken();
        return null;
    }
    return sessionStorage.getItem(TOKEN_KEY);
};

export const clearToken = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_EXPIRES_KEY);
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);
};

export const isSignedIn = () => getToken() !== null;

/** Send the player to Pollinations' consent screen. */
export const beginAuthorization = async (): Promise<void> => {
    if (!CLIENT_ID) throw new Error("This app has no App Key configured yet.");

    const verifier = randomString(64);
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(verifier),
    );
    const challenge = base64url(new Uint8Array(digest));
    const state = randomString(24);

    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, state);

    const params = new URLSearchParams({
        response_type: "code",
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scope: "usage",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
    });
    window.location.assign(`${ENTER_BASE}/authorize?${params}`);
};

/** Exchange the redirect's `code` for a key. Returns true when a callback is pending. */
export const completeAuthorization = async (): Promise<boolean> => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    if (!code) return false;

    const state = url.searchParams.get("state");
    const expectedState = sessionStorage.getItem(STATE_KEY);
    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    if (!verifier || !state || state !== expectedState) {
        clearToken();
        throw new Error("Sign-in could not be verified. Please try again.");
    }

    const response = await fetch(`${ENTER_BASE}/api/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            code_verifier: verifier,
        }),
    });

    if (!response.ok) {
        clearToken();
        throw new Error(
            `Pollinations did not accept the sign-in (${response.status}).`,
        );
    }

    const payload = (await response.json()) as {
        access_token: string;
        expires_in: number;
    };

    sessionStorage.setItem(TOKEN_KEY, payload.access_token);
    sessionStorage.setItem(
        TOKEN_EXPIRES_KEY,
        String(Date.now() + payload.expires_in * 1000),
    );
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);

    // Drop the one-shot code from the address bar without reloading.
    url.searchParams.delete("code");
    url.searchParams.delete("state");
    window.history.replaceState({}, "", url);
    return true;
};
