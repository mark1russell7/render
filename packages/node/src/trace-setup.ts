// A debug file: write the name of each test of writes.test.ts to stderr when it starts. A test that never ends shows last.
import { writeSync } from "node:fs";
import { beforeEach } from "vitest";

beforeEach((ctx) => {
  const file = ctx.task.file?.name ?? "";
  if (file.includes("writes")) writeSync(2, `TEST START: ${ctx.task.name}\n`);
});
