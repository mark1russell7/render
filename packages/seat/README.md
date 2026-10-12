# @mark1russell7/render-seat

[![npm](https://img.shields.io/npm/v/@mark1russell7/render-seat?color=2346c4)](https://www.npmjs.com/package/@mark1russell7/render-seat) [![CI](https://github.com/mark1russell7/render/actions/workflows/ci.yml/badge.svg)](https://github.com/mark1russell7/render/actions/workflows/ci.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-2346c4)](https://github.com/mark1russell7/render/blob/main/LICENSE)

Reactive path subscriptions over plain values. A seat path is a chain of seats for a path, for example `["farm", "pen", "dog"]`. A listener of the path gets a notification when the value at the path changes or disappears.

```sh
npm i @mark1russell7/render-seat
```

```ts
import { peek, registry, setRoot, subscribe } from "@mark1russell7/render-seat";

const reg = registry({ farm: { pen: { dog: "rex" } } });
subscribe(reg, ["farm", "pen", "dog"], (seat) => {
  console.log(seat.value); // { tag: "none" } after the next line
});
setRoot(reg, { farm: {} });
peek(reg, ["farm", "pen", "dog"]); // { tag: "none" }
```

A path reads only own fields of each value. Thus a path, for example `["constructor"]`, gives `none`.

## More

- [The site](https://mark1russell7.github.io/render/): the guide, live demos and the viewer.
- [The API reference](https://mark1russell7.github.io/render/reference/api/): the exports of each package.
- [The repository](https://github.com/mark1russell7/render): the source, the tests and the review of each known defect.

Each package of render is ESM, has TypeScript declarations, and works in Node.js 22.12 or later and in browsers. The license is MIT.
