/** The install command of the engine packages, with a button that copies it. */
import { useState, type ReactElement } from "react";

const COMMAND = "npm i @mark1russell7/render-node @mark1russell7/render-dsl @mark1russell7/render-splay";

/** The install line. */
export default function CopyInstall(): ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rh-install">
      <code>
        <span aria-hidden="true">$ </span>
        {COMMAND}
      </code>
      <button
        type="button"
        className="rh-copy"
        aria-label="Copy the install command"
        onClick={() => {
          void navigator.clipboard?.writeText(COMMAND).then(() => {
            setCopied(true);
            setTimeout(() => { setCopied(false); }, 1500);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
