# Instructions for Claude

## Writing style

Write all prose of this repository in the style of ASD-STE100 Simplified Technical English (STE). This prose is the README files, this file, the TSDoc comments, the docs and the text that the site and the viewer show. The linter [`ste-lint`](https://github.com/mark1russell7/ste-lint) examines it.

- After a change to prose, start `pnpm lint:ste` and correct each finding. CI fails when there is an error.
- Keep each instruction to 20 words or fewer, and each description to 25 words or fewer.
- Do not use the modal verbs (`should`, `may`, `might`, `would`), semicolons or Latin abbreviations (`e.g.`, `i.e.`, `etc.`).
- Use the active voice. Start each sentence of a doc comment with its subject: "This function returns the value", not "Returns the value".
- Put code, file names and commands in code font. The linter counts each code span as one word.
- Add a word to the glossary in `ste.config.json` only if it is a real technical term of the project.

## The plan

`docs/REVIEW.md` is the plan of record. Read it before a change to the architecture. `docs/DECISIONS.md` records each architecture decision.

## Packages

- Make a new package with `pnpm package add <name> --preset=ts`. Do not write `package.json` or `tsconfig.json` by hand.
- Each package has a `tsconfig.test.json`. `pnpm typecheck` checks the source and the tests.
- The layers are `optional`, `dsl`, `node`, `biblo`, `splay` and `viewer`. A package imports only from the layers under it.
- `pack` and `seat` are standalone. Keep `seat`: it gives reactive path subscriptions over plain values.

## Tests

- Start `pnpm check` before a commit. It does the type check, Oxlint, the coverage, the tests and `ste-lint`.
- Each defect in `docs/REVIEW.md` has a regression test that names its ID.
- `pnpm test:e2e` tests the viewer in Chromium. Its server uses port 5299. Another app uses port 5199: do not stop it.

## The site

- `packages/site` is the site of GitHub Pages (Astro and Starlight).
- `scripts/gen-docs.mjs` makes the review page and the decisions page from `docs/REVIEW.md` and `docs/DECISIONS.md`. Change the documents, not the generated pages.
- `pnpm --filter @render/site run report` writes the test report. The review page shows the status of each defect from it.
- `pnpm --filter @render/site run test:e2e` tests the built site. Its preview server uses port 4331.
