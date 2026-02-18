/**
 * An Instance is tiny — just an ID, a class reference, and a scope map.
 * No copying of class data. Instance values live in the seat graph
 * keyed by instance ID. The class provides the structure/expressions (shared).
 */

export type InstanceId = string;

export type Scope = {
  readonly self: InstanceId;
  readonly parent: InstanceId | undefined;
  readonly children: InstanceId[];
};

export type Instance = {
  readonly id: InstanceId;
  readonly classRef: string;
  readonly scope: Scope;
};

let nextId = 0;

export const generateId = (): InstanceId => `i_${String(nextId++)}`;

export const instance = (classRef: string, parent?: InstanceId): Instance => {
  const id = generateId();
  return {
    id,
    classRef,
    scope: {
      self: id,
      parent,
      children: [],
    },
  };
};

/** Add a child to a parent instance's scope (mutates children array) */
export const addChild = (parent: Instance, child: Instance): void => {
  (parent.scope.children as InstanceId[]).push(child.id);
};
