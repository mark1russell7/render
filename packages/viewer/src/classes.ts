import type { ComponentClass } from "@render/biblo";
import { app, lit, ref } from "@render/dsl";

/**
 * The classes of the viewer itself. They are normal classes: the type graph shows them, and they extend
 * `Text` with a different render method. Thus the draggable name of a class is a position in the type graph
 * (the key of a class card), and not a property of the text. A text that a person types is not a chip at any time.
 */

/** The name of a class, as a draggable chip. The keys of the class cards are instances of this class. */
export const ClassName: ComponentClass = {
  name: "ClassName",
  extends: "Text",
  cells: {},
  methods: {
    render: app("classChip", app("get", ref("self", "cells"), lit("value"))),
  },
};

/** A read-only label: the section names and the names of the atoms. */
export const Label: ComponentClass = {
  name: "Label",
  extends: "Text",
  cells: {},
  methods: {
    render: app("labelView", app("get", ref("self", "cells"), lit("value"))),
  },
};

/** The classes of the viewer, in the order of registration. */
export const viewerClasses: readonly ComponentClass[] = [ClassName, Label];
