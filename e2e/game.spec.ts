import { expect, test, type Page } from "@playwright/test";

const API_KEY = process.env.POLLINATIONS_API_KEY ?? "";
const APP = process.env.E2E_BASE_URL || "http://127.0.0.1:4173/whichever/";
const evidence = (name: string) => `evidence/${name}.png`;

const PREMISE = "a courier with a sealed letter that must reach the coast before the tide closes the road";

const shot = (page: Page, name: string) =>
    page.screenshot({ path: evidence(name), fullPage: true });

const signIn = async (page: Page) => {
    await page.goto(APP);
    await page.evaluate(
        ([key]) => sessionStorage.setItem("whichever.token", key),
        [API_KEY],
    );
    await page.reload();
    await expect(page.getByText("Signed in — this story runs on your Pollen.")).toBeVisible();
};

test.beforeEach(() => {
    expect(API_KEY, "set POLLINATIONS_API_KEY to run the live end-to-end test").not.toBe("");
});

test("writes three turns, lets Jev pick one, and draws it", async ({ page }) => {
    await signIn(page);
    await shot(page, "01-start");

    await page.locator("#premise").fill(PREMISE);
    await page.getByRole("button", { name: "Most dangerous" }).click();
    await page.getByRole("button", { name: "Let Jev decide" }).click();

    // Three turns are written, then Jev judges them against the chosen lens.
    await expect(page.locator(".candidate")).toHaveCount(3, { timeout: 120_000 });
    await expect(page.locator(".candidate.chosen")).toHaveCount(1);
    await expect(page.locator(".badge")).toContainText("Jev picked this");
    await expect(page.locator(".probnum")).toHaveCount(3);
    await expect(page.locator(".meters .meter")).toHaveCount(2);
    await expect(page.locator(".head .sub")).toContainText("judged against: Most dangerous");
    await expect(page.locator(".head .sub")).toContainText("Chapter 1 of 6");
    await shot(page, "02-verdict");

    // Taking it draws only the branch Jev chose.
    await page.getByRole("button", { name: "Take it" }).click();
    await expect(page.locator(".scene img")).toBeVisible({ timeout: 240_000 });
    await expect(page.locator(".trail .crumb")).toHaveCount(1);
    await expect(page.locator(".narrative .beat")).toHaveCount(1);
    await expect(page.locator(".head .sub")).toContainText("Chapter 1 of 6");
    await shot(page, "03-chapter-one");

    await expect(page.locator("#error")).toHaveCount(0);
});

test("changes the lens and asks Jev again without redrawing", async ({ page }) => {
    await signIn(page);
    await page.locator("#premise").fill(PREMISE);
    await page.getByRole("button", { name: "Let Jev decide" }).click();
    await expect(page.locator(".candidate")).toHaveCount(3, { timeout: 120_000 });

    // A different standard, the same three turns, a fresh verdict.
    await page.getByRole("button", { name: "Most wondrous" }).click();
    await expect(page.locator(".head .sub")).toContainText("judged against: Most wondrous", {
        timeout: 120_000,
    });
    await expect(page.locator(".candidate")).toHaveCount(3);
    await expect(page.locator(".candidate.chosen")).toHaveCount(1);
    await shot(page, "04-re-lensed");

    // The story keeps moving one chapter at a time.
    await page.getByRole("button", { name: "Take it" }).click();
    await expect(page.locator(".scene img")).toBeVisible({ timeout: 240_000 });
    await expect(page.locator(".head .sub")).toContainText("Chapter 1 of 6");

    await page.getByRole("button", { name: "Next chapter" }).click();
    await expect(page.locator(".candidate")).toHaveCount(3, { timeout: 120_000 });
    await page.getByRole("button", { name: "Take it" }).click();
    await expect(page.locator(".scene img")).toBeVisible({ timeout: 240_000 });
    await expect(page.locator(".trail .crumb")).toHaveCount(2);
    await expect(page.locator(".head .sub")).toContainText("Chapter 2 of 6");
    await expect(page.locator(".narrative .beat")).toHaveCount(2);
    await shot(page, "05-chapter-two");

    // Ending reads the whole thing back.
    await page.getByRole("button", { name: "End the story" }).click();
    await expect(page.getByText("The story, as Jev told it.")).toBeVisible();
    await expect(page.locator(".page")).toHaveCount(2);
    await shot(page, "06-the-story");

    await expect(page.locator("#error")).toHaveCount(0);
});

test("asks for a premise instead of writing a story from nothing", async ({ page }) => {
    await signIn(page);
    await page.locator("#premise").fill("");
    await page.getByRole("button", { name: "Let Jev decide" }).click();
    await expect(page.locator("#error")).toBeVisible();
    await expect(page.locator("#error")).toContainText("Type where the story starts.");
    await shot(page, "07-no-premise");
});

test("asks for Pollen instead of deciding for free", async ({ page }) => {
    await page.goto(APP);
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await page.locator("#premise").fill(PREMISE);
    await page.getByRole("button", { name: "Let Jev decide" }).click();
    await expect(page.locator("#error")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("#error")).toContainText("Sign in with your Pollen");
    await expect(page.getByRole("button", { name: "Sign in with your Pollen" })).toBeVisible();
    await shot(page, "08-signin-required");
});

test("sign-in hands off to the Pollinations consent screen", async ({ page }) => {
    test.skip(
        !process.env.E2E_BASE_URL,
        "the local preview port is not a registered redirect URI",
    );
    await page.goto(APP);
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();

    await page.getByRole("button", { name: "Sign in with your Pollen" }).click();
    await page.waitForURL(/enter\.pollinations\.ai\/authorize/, { timeout: 60_000 });

    const url = new URL(page.url());
    expect(url.searchParams.get("client_id")).toMatch(/^pk_/);
    expect(url.searchParams.get("redirect_uri")).toBe(APP);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBeTruthy();

    // The consent screen must name the app, not fall back to the hostname.
    await expect(page.getByText("Whichever", { exact: true })).toBeVisible({ timeout: 60_000 });
    await shot(page, "09-consent");
});
