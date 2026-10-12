/**
 * The viewer of render in a page of the site. The page loads it only in the browser (`client:only`), because
 * the viewer measures its cards. The class `not-content` keeps the styles of the page away from the viewer.
 */
import type { ReactElement } from "react";
import { App, SESSION_KEY } from "@mark1russell7/render-viewer";
import "@mark1russell7/render-viewer/styles.css";

/** The embedded viewer. */
export default function ViewerEmbed(): ReactElement {
  return (
    <div className="rd-viewer not-content" role="application" aria-label="The render viewer">
      <App storageKey={SESSION_KEY} />
    </div>
  );
}
