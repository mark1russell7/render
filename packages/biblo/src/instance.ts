/** The identity of an instance. It is also the ID of the root node of the instance. */
export type InstanceId = string;

/**
 * The scope of an instance: the names that its expressions can use.
 * `ref("self", ...)` reads this instance, and `ref("parent", ...)` reads the parent instance.
 */
export type Scope = {
  readonly self: InstanceId;
  readonly parent: InstanceId | undefined;
  /** The child instances, in order. Splay renders them, and dehydrate reads them. */
  readonly children: readonly InstanceId[];
};

/**
 * An instance is small: an ID, a class name and a scope. It copies no data of its class.
 * The values of its cells are in the node store, in the slots of its root node.
 */
export type Instance = {
  readonly id: InstanceId;
  readonly classRef: string;
  readonly scope: Scope;
};
