# @mark1russell7/render-pack

[![npm](https://img.shields.io/npm/v/@mark1russell7/render-pack?color=2346c4)](https://www.npmjs.com/package/@mark1russell7/render-pack) [![CI](https://github.com/mark1russell7/render/actions/workflows/ci.yml/badge.svg)](https://github.com/mark1russell7/render/actions/workflows/ci.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-2346c4)](https://github.com/mark1russell7/render/blob/main/LICENSE)

Rectangle packing for layouts: a guillotine row packer and a skyline packer that place rectangles in an outer rectangle.

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

## Strategies

`pack` sets the width of the outer rectangle, and then packs with a strategy:

```ts
pack(rects, outer, { strategy: "skyline", sortOrder: "area-desc" });
```

- `packRows` (the default): a guillotine row packing. It fills the space under the short rectangles of each row.
- `packSkyline`: each rectangle goes to the lowest place where it fits. It packs around a `locked` rectangle.

Both functions also work alone, in an outer rectangle with a width that you set. They do not change the width.

A `locked` rectangle keeps its position. `packSkyline` puts the other rectangles under it. `packRows` only keeps its position.

The sort orders are `height-desc` (the default), `height-asc`, `width-desc` and `area-desc`. `SORT_ORDERS` lists them, and `compareRects` gives the comparator of one.

## More

- [The site](https://mark1russell7.github.io/render/): the guide, live demos and the viewer.
- [The API reference](https://mark1russell7.github.io/render/reference/api/): the exports of each package.
- [The repository](https://github.com/mark1russell7/render): the source, the tests and the review of each known defect.

Each package of render is ESM, has TypeScript declarations, and works in Node.js 22.12 or later and in browsers. The license is MIT.
