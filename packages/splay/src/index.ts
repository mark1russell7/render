

type PrimitiveTypes = 'string' | 'number' | 'boolean' | 'null' | 'undefined';
type CompositeTypes = 'object' | 'array';
type HTMLPrimitiveTypes = 'div' | 'span' | 'p' | 'a' | 'img' | 'button' | 'input' | 'textarea' | 'select' | 'option' | 'label' | 'form' | 'table' | 'tr' | 'td' | 'th' | 'ul' | 'ol' | 'li';

type Component = {
    type : string;

}


/** Generic Iterator */
type Iterator<T> = {
    next: () => { value: T, done: boolean }
}

type UnorderedPlacer = {
    position: (component: Component) => [number, number]; 
}

type UnorderedSizer = {
    size: (component: Component) => [number, number];
}

type OrderedPlacer = {
    position: (component: Component, index: number) => [number, number]; 
}

type OrderedSizer = {
    size: (component: Component, index: number) => [number, number];
}

