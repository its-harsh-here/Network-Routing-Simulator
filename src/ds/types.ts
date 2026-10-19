/**
 * Orders two values: negative if `a` comes first, positive if `b` comes first, 0 if tied.
 * Same contract as the callback of Array.prototype.sort, so `(a, b) => a - b` sorts numbers
 * ascending.
 */
export type Comparator<T> = (a: T, b: T) => number
