/**
 * The viewer of render in a page of the site. The page loads it only in the browser (`client:only`), because
 * the viewer measures its cards. The class `not-content` keeps the styles of the page away from the viewer.
 */
import type { ReactElement } from "react";
import { App } from "@render/viewer";
import "@render/viewer/styles.css";

/** The embedded viewer. */
export default function ViewerEmbed(): ReactElement {
  return (
    <div className="rd-viewer not-content" role="application" aria-label="The render viewer">
      <App />
    </div>
  );
}
