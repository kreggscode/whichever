# Whichever

**A story where you set the lens and Jev picks the branch.**

You type where the story starts and choose what it should be judged against. A text
model writes three candidate turns, [`POST /alpha/decisions`](https://gen.pollinations.ai/docs)
decides which one happens, and the image model draws whatever Jev chose.

You never pick the turn. You pick the standard it is judged by.

<https://kreggscode.github.io/whichever/>

## The loop

```
premise + lens
     │
     ▼
 text model  ──►  three candidate turns      openai/gpt-5.4-nano
     │
     ▼
 Jev         ──►  which one, how tense,      POST /alpha/decisions
                  is the goal out of reach?   (choice + score + noul)
     │
     ▼
 image model ──►  the chosen branch, drawn   microsoft/mai-image-2.6-flash
                  from the last plate         (reference image)
```

Each turn costs one text call, one decision and one image. The decision is the
cheap, fast part — Jev answers in around three seconds — so re-asking it under a
different lens costs almost nothing. Only *taking* the turn costs a render, and
you only take it once you like the verdict.

### What Jev is asked

One request, three typed questions, all answered independently:

| Question | Type | What it gives back |
|---|---|---|
| `branch` | `choice` | which turn happens, plus a probability per turn and a confidence |
| `tension` | `score` | a position along `quiet → uneasy → urgent → dire`, with a `legend` |
| `goalAtRisk` | `noul` | the probability the protagonist's original goal is now out of reach |

`state` carries the premise and every chapter so far; the lens goes in
`instructions`, since that is the judgment being asked for rather than a fact.

## Controls

- **The lens** — six presets (`Changes what they want`, `Most dangerous`,
  `Most irreversible`, `Most wondrous`, `Kindest`, `Funniest`) or your own.
  Changing it on the decide screen re-asks Jev over the same three turns without
  redrawing anything.
- **Art style** — watercolour, ink and wash, risograph, woodcut, nocturne. The
  first plate sets the tone and every later plate uses it as a reference, so six
  chapters look like one story.
- **Six chapters**, then an ending you can read straight through.

## Run it

```bash
npm install
npm run dev
```

Bring your own Pollen — the app signs in through Pollinations and spends the
player's own balance, never the developer's:

```bash
echo "VITE_POLLINATIONS_CLIENT_ID=pk_yourkey" > .env.local
```

The `pk_...` key is publishable by design: it only names the app on the consent
screen and attributes traffic. The scoped `sk_...` returned after consent is the
value that must stay in memory.

## Checks

```bash
npm run lint   # tsc --noEmit
npm test       # 35 tests — 29 pure, 6 live against the real endpoints
npm run build
```

The pure tests cover the shape of a decision without spending anything: what
gets posted to Jev, how the `legend` is read, and how a reply that picks a turn
nobody wrote is refused.

The live tests run the whole chain — write the turns, let Jev pick one, draw it,
then draw the next one using the last as a reference.

```bash
# end-to-end, against the deployed app
POLLINATIONS_API_KEY=sk_... E2E_BASE_URL=https://kreggscode.github.io/whichever/ npx playwright test
```

Screenshots land in `evidence/`.

## Why this and not a free-text judge

`POST /alpha/decisions` returns calibrated probabilities and a confidence for
every answer, not prose. That is what makes the verdict legible: the app can show
you *how sure* Jev was (0.69 on a tight call, 1.00 on an easy one) and what the
other turns scored, rather than asking you to trust a paragraph. Counting,
arithmetic and date comparisons stay in code; Jev supplies the judgment.

See [BRING_YOUR_OWN_POLLEN.md](https://github.com/pollinations/pollinations/blob/main/BRING_YOUR_OWN_POLLEN.md)
for the consent flow.
