# Working on this repository

The owner, Sola, often makes changes from his phone through Claude Code. Production deploys on Netlify cost credits, so follow these rules exactly.

## Branches

- Do all work on the `preview` branch. Check it out first: `git fetch origin && git checkout preview && git pull`.
- Never commit or push to `main`. Never force-push.
- Production is updated only when Sola says "release" (or "approve," "ship it," "publish"). Then open a pull request from `preview` to `main` with `gh pr create --base main --head preview`, and merge it with a merge commit (`gh pr merge --merge`). The merge commit message must keep GitHub's default "Merge pull request #N" so `scripts/netlify-ignore.sh` lets the production build run.
- If a release is requested while the preview build is failing, say so and don't merge.

## Before every push

1. `npm test`
2. `npm run build`

Push only when both pass. After pushing, tell Sola that the preview is at `https://preview--<site>.netlify.app` and what to check there.

## Conventions

- React 18 with Vite, plain JavaScript, no TypeScript. Styles live in `src/styles.css` with CSS variables for the palette (Blueberry #243B8F, Cream Soda #FDF1C9, Sunflower #FFC20D). Gold is a fill color only; use `--gold-ink` when gold must be text.
- Base font size is 17px and touch targets are at least 44px. Check every UI change at 390px, 820px and 1440px widths.
- All data writes go through `src/data/actions.js` so both backends (Firebase and demo) stay in sync. If you add a field that requesters can write, update `firestore.rules` too.
- US spelling and dates (November 9, 2026).
- Keep buttons to a minimum. Prefer gestures, inline chips, autosave and Undo toasts over confirm dialogs and Save buttons.
