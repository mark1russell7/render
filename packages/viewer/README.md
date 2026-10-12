# @mark1russell7/render-viewer

[![npm](https://img.shields.io/npm/v/@mark1russell7/render-viewer?color=2346c4)](https://www.npmjs.com/package/@mark1russell7/render-viewer) [![CI](https://github.com/mark1russell7/render/actions/workflows/ci.yml/badge.svg)](https://github.com/mark1russell7/render/actions/workflows/ci.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-2346c4)](https://github.com/mark1russell7/render/blob/main/LICENSE)

The live editor of render, as a React component. The type graph shows each class as data, and the canvas holds instances. An edit of an instance or of a class changes the class at once, and each instance follows it. The viewer has summaries, a formula editor, undo and redo, and saved sessions.

```sh
npm i @mark1russell7/render-viewer react react-dom
```

```tsx
import { App } from "@mark1russell7/render-viewer";
import "@mark1russell7/render-viewer/styles.css";

// With a storage key, the viewer saves its session in the local storage of the browser
export function Editor() {
  return <App storageKey="my-render-session" />;
}
```

`ViewerSession` is the model of the viewer without React: its actions, undo and redo, `save`, `restore` and `open`. Try the viewer on [the site](https://mark1russell7.github.io/render/viewer/).

## More

- [The site](https://mark1russell7.github.io/render/): the guide, live demos and the viewer.
- [The API reference](https://mark1russell7.github.io/render/reference/api/): the exports of each package.
- [The repository](https://github.com/mark1russell7/render): the source, the tests and the review of each known defect.

Each package of render is ESM, has TypeScript declarations, and works in Node.js 22.12 or later and in browsers. The license is MIT.
