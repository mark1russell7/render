import type { ComponentClass } from "@render/biblo";
import { app, lit, ref } from "@render/dsl";

/**
 * The classes of the viewer itself. They are normal classes: the type graph shows them, and they extend
 * standard classes with a different render method. Thus the draggable name of a class is a position in the type
 * graph (the key of a class card), and not a property of the text. A text that a person types is not a chip at any time.
 */

const cell = (name: string) => app("get", ref("self", "cells"), lit(name));

const classChipRender = app("classChip", cell("value"), cell("traits"));

/** The name of a class, as a draggable chip with the names of its traits. The keys of the class cards are instances of this class. */
export const ClassName: ComponentClass = {
  name: "ClassName",
  extends: "Text",
  cells: {
    traits: { expr: lit([]) },
  },
  methods: {
    render: classChipRender,
    summary: classChipRender,
  },
};

const labelRender = app("labelView", cell("value"));

/** A read-only label: the section names and the names of the atoms. */
export const Label: ComponentClass = {
  name: "Label",
  extends: "Text",
  cells: {},
  methods: {
    render: labelRender,
    summary: labelRender,
  },
};

/**
 * The definition of a class in the type graph. Its full view is the view of a `Grid`. Its summary is the
 * boundary of the class: its parent, its cells and its methods. The summary binds the dehydrated definition to
 * the name `d` with a `fn` form, thus the definition dehydrates one time.
 */
export const ClassDef: ComponentClass = {
  name: "ClassDef",
  extends: "Grid",
  cells: {},
  methods: {
    summary: app("call",
      app("fn", lit(["d"]),
        app("boundaryView",
          app("get", ref("d"), lit("extends")),
          app("keys", app("or", app("get", ref("d"), lit("cells")), lit({}))),
          app("keys", app("or", app("get", ref("d"), lit("methods")), lit({}))))),
      app("call", ref("self", "dehydrate"))),
  },
};

/** The classes of the viewer, in the order of registration. */
export const viewerClasses: readonly ComponentClass[] = [ClassName, Label, ClassDef];
