/**
 * The status chip of a defect: its ID and the status of its regression tests. The status comes from the test
 * report that `scripts/test-report.mjs` writes before the build. Without a report, the status is "unknown".
 */
import type { ReactElement } from "react";

interface ReportTest {
  readonly package: string;
  readonly name: string;
  readonly state: "pass" | "fail" | "skip";
}

interface Report {
  readonly generatedAt: string;
  readonly tests: readonly ReportTest[];
}

const found = import.meta.glob<{ readonly default: Report }>("../data/test-report.json", { eager: true });
const report: Report | undefined = Object.values(found)[0]?.default;

/** This function gives the tests whose names contain the ID, for example `R-07:`. */
export function testsFor(id: string): readonly ReportTest[] {
  const re = new RegExp(`(^|[^A-Z0-9-])${id}([^0-9]|$)`);
  return report?.tests.filter((t) => re.test(t.name)) ?? [];
}

/** The time of the report, or `undefined` for a build without a report. */
export const reportTime: string | undefined = report?.generatedAt;

/** The chip. */
export default function Regression(props: { readonly id: string }): ReactElement {
  const tests = testsFor(props.id);
  const state = report === undefined || tests.length === 0 ? "unknown" : tests.some((t) => t.state === "fail") ? "fail" : "pass";
  const mark = state === "pass" ? "✓" : state === "fail" ? "✗" : "?";
  const title =
    state === "unknown"
      ? "This build has no test report for this defect."
      : tests.map((t) => `${t.state === "pass" ? "✓" : "✗"} ${t.package}: ${t.name}`).join("\n");
  const status = state === "pass" ? `${String(tests.length)} tests pass` : state === "fail" ? "a test fails" : "status unknown";
  return (
    <span className="rd-chip" data-state={state} id={props.id} title={title}>
      {props.id}
      <span aria-hidden="true">{mark}</span>
      <span className="visually-hidden">{status}</span>
    </span>
  );
}
