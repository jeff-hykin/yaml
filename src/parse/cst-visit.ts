import type { CollectionItem, Document } from "./cst.ts" 

const BREAK = Symbol('break visit')
const SKIP = Symbol('skip children')
const REMOVE = Symbol('remove item')

export type VisitPath = readonly ['key' | 'value', number][]

export type Visitor = (
  item: CollectionItem,
  path: VisitPath
) => number | symbol | Visitor | void

/**
 * Apply a visitor to a CST document or item.
 *
 * Walks through the tree (depth-first) starting from the root, calling a
 * `visitor` function with two arguments when entering each item:
 *   - `item`: The current item, which included the following members:
 *     - `start: SourceToken[]` – Source tokens before the key or value,
 *       possibly including its anchor or tag.
 *     - `key?: Token | null` – Set for pair values. May then be `null`, if
 *       the key before the `:` separator is empty.
 *     - `sep?: SourceToken[]` – Source tokens between the key and the value,
 *       which should include the `:` map value indicator if `value` is set.
 *     - `value?: Token` – The value of a sequence item, or of a map pair.
 *   - `path`: The steps from the root to the current node, as an array of
 *     `['key' | 'value', number]` tuples.
 *
 * The return value of the visitor may be used to control the traversal:
 *   - `undefined` (default): Do nothing and continue
 *   - `visit.SKIP`: Do not visit the children of this token, continue with
 *      next sibling
 *   - `visit.BREAK`: Terminate traversal completely
 *   - `visit.REMOVE`: Remove the current item, then continue with the next one
 *   - `number`: Set the index of the next step. This is useful especially if
 *     the index of the current token has changed.
 *   - `function`: Define the next visitor for this item. After the original
 *     visitor is called on item entry, next visitors are called after handling
 *     a non-empty `key` and when exiting the item.
 */
export function visit(cst: Document | CollectionItem, visitor: Visitor) {
  if ('type' in cst && cst.type === 'document')
    cst = { start: cst.start, value: cst.value }
  _visit(Object.freeze([]), cst, visitor)
}

// Without the `as symbol` casts, TS declares these in the `visit`
// namespace using `var`, but then complains about that because
// `unique symbol` must be `const`.

/** Terminate visit traversal completely */
visit.BREAK = BREAK as symbol

/** Do not visit the children of the current item */
visit.SKIP = SKIP as symbol

/** Remove the current item */
visit.REMOVE = REMOVE as symbol

/** Find the item at `path` from `cst` as the root */
visit.itemAtPath = (cst: Document | CollectionItem, path: VisitPath) => {
  let item: CollectionItem = cst
  for (const [field, index] of path) {
    const tok = item?.[field]
    if (tok && 'items' in tok) {
      item = tok.items[index]
    } else return undefined
  }
  return item
}

/**
 * Get the immediate parent collection of the item at `path` from `cst` as the root.
 *
 * Throws an error if the collection is not found, which should never happen if the item itself exists.
 */
visit.parentCollection = (cst: Document | CollectionItem, path: VisitPath) => {
  const parent = visit.itemAtPath(cst, path.slice(0, -1))
  const field = path[path.length - 1][0]
  const coll = parent?.[field]
  if (coll && 'items' in coll) return coll
  throw new Error('Parent collection not found')
}

function _visit(
  path: VisitPath,
  item: CollectionItem,
  visitor: Visitor
): number | symbol | Visitor | void {
  let ctrl = visitor(item, path)
  if (typeof ctrl === 'symbol') return ctrl
  for (const field of ['key', 'value'] as const) {
    const token = item[field]
    if (token && 'items' in token) {
      for (let i = 0; i < token.items.length; ++i) {
        const ci = _visit(
          Object.freeze(path.concat([[field, i]])),
          token.items[i],
          visitor
        )
        if (typeof ci === 'number') i = ci - 1
        else if (ci === BREAK) return BREAK
        else if (ci === REMOVE) {
          token.items.splice(i, 1)
          i -= 1
        }
      }
      if (typeof ctrl === 'function' && field === 'key') ctrl = ctrl(item, path)
    }
  }
  return typeof ctrl === 'function' ? ctrl(item, path) : ctrl
}
