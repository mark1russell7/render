# @mark1russell7/render-optional

[![npm](https://img.shields.io/npm/v/@mark1russell7/render-optional?color=2346c4)](https://www.npmjs.com/package/@mark1russell7/render-optional) [![CI](https://github.com/mark1russell7/render/actions/workflows/ci.yml/badge.svg)](https://github.com/mark1russell7/render/actions/workflows/ci.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-2346c4)](https://github.com/mark1russell7/render/blob/main/LICENSE)

The `Optional` type of render: a present value (`some`) or an absent value (`none`). The evaluation of render is total, thus a failure gives `none` with a cause, not an exception.

```sh
npm i @mark1russell7/render-optional
```

```ts
import { getOr, isSome, map, none, some } from "@mark1russell7/render-optional";

const width = some(21);
const doubled = map(width, (w) => w * 2); // { tag: "some", value: 42 }
isSome(doubled); // true
getOr(none, 0); // 0
```

The form is structural: any value with the same fields is an `Optional` of this package.

## More

- [The site](https://mark1russell7.github.io/render/): the guide, live demos and the viewer.
- [The API reference](https://mark1russell7.github.io/render/reference/api/): the exports of each package.
- [The repository](https://github.com/mark1russell7/render): the source, the tests and the review of each known defect.

Each package of render is ESM, has TypeScript declarations, and works in Node.js 22.12 or later and in browsers. The license is MIT.
