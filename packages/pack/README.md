# @mark1russell7/render-pack

[![npm](https://img.shields.io/npm/v/@mark1russell7/render-pack?color=2346c4)](https://www.npmjs.com/package/@mark1russell7/render-pack) [![CI](https://github.com/mark1russell7/render/actions/workflows/ci.yml/badge.svg)](https://github.com/mark1russell7/render/actions/workflows/ci.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-2346c4)](https://github.com/mark1russell7/render/blob/main/LICENSE)

Rectangle packing for layouts: a guillotine row packer that places rectangles in an outer rectangle.

```sh
npm i @mark1russell7/render-pack
```

```ts
import { pack, Rect } from "@mark1russell7/render-pack";

const rects = [[30, 10], [20, 20], [10, 5]].map(([w, h]) => {
  const r = new Rect<string>();
  r.size.set(w, h);
  return r;
});
const outer = pack(rects);
outer.size; // the size of the layout
rects[0].position; // the place of the first rectangle
```

Without fixed sizes, the outer rectangle grows until all rectangles fit. With `fixedWidth`, the width stays. With `fixedSize`, a rectangle that does not fit stays unpacked.

## More

- [The site](https://mark1russell7.github.io/render/): the guide, live demos and the viewer.
- [The API reference](https://mark1russell7.github.io/render/reference/api/): the exports of each package.
- [The repository](https://github.com/mark1russell7/render): the source, the tests and the review of each known defect.

Each package of render is ESM, has TypeScript declarations, and works in Node.js 22.12 or later and in browsers. The license is MIT.
