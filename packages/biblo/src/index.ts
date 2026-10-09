export { type CellDef, type ComponentClass, componentClass, extendClass } from "./class.ts";
export type { InstanceId, Scope, Instance } from "./instance.ts";
export {
  type Biblo, biblo, registerClass, registerClasses, resolveCells, resolveMethods,
  instantiate, destroyInstance, moveChild, updateClass, ownerOf, renameClass,
  registerTrait, unregisterTrait, resolveTraits, classFingerprint, primeOf,
} from "./registry.ts";
export { type Trait, type TraitResolution, requirementAtoms } from "./traits.ts";
export { classNodeOps } from "./nodeops.ts";
