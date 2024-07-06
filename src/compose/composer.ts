import process from "node:process"
import { Directives } from "../doc/directives.ts" 
import { Document } from "../doc/Document.ts" 
import { ErrorCode, YAMLParseError, YAMLWarning } from "../errors.ts" 
import { isCollection, isPair } from "../nodes/identity.ts" 
import type { ParsedNode, Range } from "../nodes/Node.ts" 
import type {
  DocumentOptions,
  ParseOptions,
  SchemaOptions
} from "../options.ts" 
import type { Token } from "../parse/cst.ts" 
import { composeDoc } from "./compose-doc.ts" 
import { resolveEnd } from "./resolve-end.ts" 

type ErrorSource =
  | number
  | [number, number]
  | Range
  | { offset: number; source?: string }

export type ComposeErrorHandler = (
  source: ErrorSource,
  code: ErrorCode,
  message: string,
  warning?: boolean
) => void

function getErrorPos(src: ErrorSource): [number, number] {
  if (typeof src === 'number') return [src, src + 1]
  if (Array.isArray(src)) return src.length === 2 ? src : [src[0], src[1]]
  const { offset, source } = src
  return [offset, offset + (typeof source === 'string' ? source.length : 1)]
}

function parsePrelude(prelude: string[]) {
  let comment = ''
  let atComment = false
  let afterEmptyLine = false
  for (let i = 0; i < prelude.length; ++i) {
    const source = prelude[i]
    switch (source[0]) {
      case '#':
        comment +=
          (comment === '' ? '' : afterEmptyLine ? '\n\n' : '\n') +
          (source.substring(1) || ' ')
        atComment = true
        afterEmptyLine = false
        break
      case '%':
        if (prelude[i + 1]?.[0] !== '#') i += 1
        atComment = false
        break
      default:
        // This may be wrong after doc-end, but in that case it doesn't matter
        if (!atComment) afterEmptyLine = true
        atComment = false
    }
  }
  return { comment, afterEmptyLine }
}

/**
 * Compose a stream of CST nodes into a stream of YAML Documents.
 *
 * ```ts
 * import { Composer, Parser } from 'yaml'
 *
 * const src: string = ...
 * const tokens = new Parser().parse(src)
 * const docs = new Composer().compose(tokens)
 * ```
 */
export class Composer<
  Contents extends ParsedNode = ParsedNode,
  Strict extends boolean = true
> {
  private directives: Directives
  private doc: Document.Parsed<Contents, Strict> | null = null
  private options: ParseOptions & DocumentOptions & SchemaOptions
  private atDirectives = false
  private prelude: string[] = []
  private errors: YAMLParseError[] = []
  private warnings: YAMLWarning[] = []

  constructor(options: ParseOptions & DocumentOptions & SchemaOptions = {}) {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    this.directives = new Directives({ version: options.version || '1.2' })
    this.options = options
  }

  private onError: ComposeErrorHandler = (source, code, message, warning) => {
    const pos = getErrorPos(source)
    if (warning) this.warnings.push(new YAMLWarning(pos, code, message))
    else this.errors.push(new YAMLParseError(pos, code, message))
  }

  private decorate(doc: Document.Parsed<Contents, Strict>, afterDoc: boolean) {
    const { comment, afterEmptyLine } = parsePrelude(this.prelude)
    //console.log({ dc: doc.comment, prelude, comment })
    if (comment) {
      const dc = doc.contents
      if (afterDoc) {
        doc.comment = doc.comment ? `${doc.comment}\n${comment}` : comment
      } else if (afterEmptyLine || doc.directives.docStart || !dc) {
        doc.commentBefore = comment
      } else if (isCollection(dc) && !dc.flow && dc.items.length > 0) {
        let it = dc.items[0]
        if (isPair(it)) it = it.key
        const cb = it.commentBefore
        it.commentBefore = cb ? `${comment}\n${cb}` : comment
      } else {
        const cb = dc.commentBefore
        dc.commentBefore = cb ? `${comment}\n${cb}` : comment
      }
    }

    if (afterDoc) {
      Array.prototype.push.apply(doc.errors, this.errors)
      Array.prototype.push.apply(doc.warnings, this.warnings)
    } else {
      doc.errors = this.errors
      doc.warnings = this.warnings
    }

    this.prelude = []
    this.errors = []
    this.warnings = []
  }

  /**
   * Current stream status information.
   *
   * Mostly useful at the end of input for an empty stream.
   */
  streamInfo() {
    return {
      comment: parsePrelude(this.prelude).comment,
      directives: this.directives,
      errors: this.errors,
      warnings: this.warnings
    }
  }

  /**
   * Compose tokens into documents.
   *
   * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
   * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
   */
  *compose(tokens: Iterable<Token>, forceDoc = false, endOffset = -1) {
    for (const token of tokens) yield* this.next(token)
    yield* this.end(forceDoc, endOffset)
  }

  /** Advance the composer by one CST token. */
  *next(token: Token) {
    if (process.env.LOG_STREAM) console.dir(token, { depth: null })
    switch (token.type) {
      case 'directive':
        this.directives.add(token.source, (offset, message, warning) => {
          const pos = getErrorPos(token)
          pos[0] += offset
          this.onError(pos, 'BAD_DIRECTIVE', message, warning)
        })
        this.prelude.push(token.source)
        this.atDirectives = true
        break
      case 'document': {
        const doc = composeDoc<Contents, Strict>(
          this.options,
          this.directives,
          token,
          this.onError
        )
        if (this.atDirectives && !doc.directives.docStart)
          this.onError(
            token,
            'MISSING_CHAR',
            'Missing directives-end/doc-start indicator line'
          )
        this.decorate(doc, false)
        if (this.doc) yield this.doc
        this.doc = doc
        this.atDirectives = false
        break
      }
      case 'byte-order-mark':
      case 'space':
        break
      case 'comment':
      case 'newline':
        this.prelude.push(token.source)
        break
      case 'error': {
        const msg = token.source
          ? `${token.message}: ${JSON.stringify(token.source)}`
          : token.message
        const error = new YAMLParseError(
          getErrorPos(token),
          'UNEXPECTED_TOKEN',
          msg
        )
        if (this.atDirectives || !this.doc) this.errors.push(error)
        else this.doc.errors.push(error)
        break
      }
      case 'doc-end': {
        if (!this.doc) {
          const msg = 'Unexpected doc-end without preceding document'
          this.errors.push(
            new YAMLParseError(getErrorPos(token), 'UNEXPECTED_TOKEN', msg)
          )
          break
        }
        this.doc.directives.docEnd = true
        const end = resolveEnd(
          token.end,
          token.offset + token.source.length,
          this.doc.options.strict,
          this.onError
        )
        this.decorate(this.doc, true)
        if (end.comment) {
          const dc = this.doc.comment
          this.doc.comment = dc ? `${dc}\n${end.comment}` : end.comment
        }
        this.doc.range[2] = end.offset
        break
      }
      default:
        this.errors.push(
          new YAMLParseError(
            getErrorPos(token),
            'UNEXPECTED_TOKEN',
            `Unsupported token ${token.type}`
          )
        )
    }
  }

  /**
   * Call at end of input to yield any remaining document.
   *
   * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
   * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
   */
  *end(forceDoc = false, endOffset = -1) {
    if (this.doc) {
      this.decorate(this.doc, true)
      yield this.doc
      this.doc = null
    } else if (forceDoc) {
      const opts = Object.assign({ _directives: this.directives }, this.options)
      const doc = new Document(undefined, opts) as Document.Parsed<
        Contents,
        Strict
      >
      if (this.atDirectives)
        this.onError(
          endOffset,
          'MISSING_CHAR',
          'Missing directives-end indicator line'
        )
      doc.range = [0, endOffset, endOffset]
      this.decorate(doc, false)
      yield doc
    }
  }
}
