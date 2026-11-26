# Roadmap

This file is the plan of render. The Status page of the site reads it.

| ID | Item | Status | Summary |
| --- | --- | --- | --- |
| C1 | The conventions check in CI | in progress | CI starts `pnpm check:conventions`, the rules of `@mark1russell7/conventions`. The packages have no console call. A new call fails at once, and each call fails from 2027-01-20. |
| C2 | Typed scripts | later | The scripts of `scripts/` and `packages/site/scripts/` and the Astro config are JavaScript. Each one becomes TypeScript, with a typecheck and a test. Then the exception of the rule `typed-scripts` goes. |
