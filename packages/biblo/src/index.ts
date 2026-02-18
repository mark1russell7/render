export { type CellDef, type ComponentClass, componentClass, extendClass } from "./class.js";
export { type InstanceId, type Scope, type Instance, instance, addChild, generateId } from "./instance.js";
export {
  type Biblo, biblo, registerClass, resolveCells, resolveMethods,
  analyzePathStructure, instantiate, resolveScope,
} from "./registry.js";
