/**
 * @lickle/lex
 *
 * A tiny, type-safe parser combinator library.
 *
 * A {@link Parser} is just a function `(input, pos) => Result`. You build big
 * parsers from small ones by composing combinators, then run them with
 * {@link parse}, which requires the whole input to be consumed and throws on
 * failure.
 *
 * The building blocks fall into a few groups:
 * - **primitives** match raw text: {@link char}, {@link str}, {@link regex},
 *   {@link satisfy}, {@link oneOf}, {@link digit}, {@link letter}, {@link eof}.
 * - **combinators** glue parsers together: {@link map}, {@link seq},
 *   {@link alt}, {@link many}, {@link opt}, {@link sepBy}, {@link between}.
 * - **lexers** handle whitespace and tokens: {@link token}, {@link symbol},
 *   {@link keyword}, {@link identifier}, {@link numberLit}, {@link stringLit}.
 *
 * @example
 * Match a single token:
 * ```ts
 * import { parse, intLit } from '@lickle/lex'
 *
 * parse(intLit, '-42') // -42
 * ```
 *
 * @example
 * Compose combinators into a grammar — a comma-separated list of ints in brackets:
 * ```ts
 * import { parse, between, sepBy, symbol, intLit } from '@lickle/lex'
 *
 * const list = between(symbol('['), sepBy(intLit, symbol(',')), symbol(']'))
 * parse(list, '[1, 2, 3]') // [1, 2, 3]
 * ```
 *
 * @example
 * Recursive grammars use {@link lazy} to reference a parser before it's defined:
 * ```ts
 * import { parse, lazy, alt, intLit, between, symbol, type Parser } from '@lickle/lex'
 *
 * // a value is an int or a parenthesised value
 * const value: Parser<number, any> = lazy(() => alt(intLit, between(symbol('('), value, symbol(')'))))
 * parse(value, '((7))') // 7
 * ```
 */

/**
 * A successful parse: carries the produced `value` and the offset `pos` reached.
 *
 * @example
 * ```ts
 * const r: Ok<number> = { ok: true, value: 42, pos: 2 }
 * ```
 */
export interface Ok<T> {
  ok: true
  value: T
  pos: number
}

/**
 * A failed parse: carries the failure offset `pos` and an optional `error`.
 *
 * @example
 * ```ts
 * const r: Err = { ok: false, pos: 0, error: new Error('boom') }
 * ```
 */
export interface Err<E = Error> {
  ok: false
  pos: number
  error?: E
  /** Set by `cut`; stops `alt` from trying further branches */
  fatal?: boolean
}

/**
 * The outcome of running a parser: either {@link Ok} or {@link Err}.
 *
 * @example
 * ```ts
 * const r: Result<string> = ok(1, 'a')
 * ```
 */
export type Result<T, E = Error> = Ok<T> | Err<E>

/**
 * A parser: given `input` and a start `pos`, produces a {@link Result}.
 *
 * @example
 * ```ts
 * const a: Parser<'a'> = char('a')
 * a('abc', 0) // { ok: true, value: 'a', pos: 1 }
 * ```
 */
export type Parser<T, E = Error> = (input: string, pos: number) => Result<T, E>

/**
 * Construct a successful {@link Ok} result.
 *
 * @example
 * ```ts
 * ok(1, 'a') // { ok: true, value: 'a', pos: 1 }
 * ```
 *
 * @group Results
 */
export const ok = <T>(pos: number, value: T): Ok<T> => ({ ok: true, value, pos })

/**
 * Construct a failed {@link Err} result.
 *
 * @example
 * ```ts
 * err(0, new Error('nope')) // { ok: false, pos: 0, error: Error }
 * ```
 *
 * @group Results
 */
export const err = <E = Error>(pos: number, error: E): Err<E> => ({ ok: false, pos, error })

// ---- primitives ----
/**
 * Match a single literal character `c`.
 *
 * @example
 * ```ts
 * parse(char('a'), 'a') // 'a'
 * ```
 *
 * @group Primitives
 */
export const char = <C extends string = string>(c: C): Parser<C, ExpectedError> =>
  function char(input, pos) {
    return input[pos] === c ? ok(pos + 1, c) : err(pos, new ExpectedError(pos, `'${c}'`))
  }

/**
 * Match the exact string `s`.
 *
 * @example
 * ```ts
 * parse(str('let'), 'let') // 'let'
 * ```
 *
 * @group Primitives
 */
export const str = <K extends string = string>(s: K): Parser<K, ExpectedError> =>
  function str(input, pos) {
    return input.startsWith(s, pos) ? ok(pos + s.length, s) : err(pos, new ExpectedError(pos, `'${s}'`))
  }

/**
 * Match `re` anchored at the current offset (the regex is forced sticky).
 *
 * @example
 * ```ts
 * parse(regex(/[0-9]+/, 'digits'), '123') // '123'
 * ```
 *
 * @group Primitives
 */
export const regex = (re: RegExp, expected?: string): Parser<string, ExpectedError> => {
  // force sticky so matching is anchored at pos; drop g/y but keep i/u/m/s
  const sticky = new RegExp(re.source, re.flags.replace(/[gy]/g, '') + 'y')
  return function regex(input, pos) {
    sticky.lastIndex = pos
    const m = sticky.exec(input)
    return m ? ok(pos + m[0].length, m[0]) : err(pos, new ExpectedError(pos, expected ?? re.source))
  }
}

/**
 * Succeed only at the end of input, producing `null`.
 *
 * @example
 * ```ts
 * parse(left(char('a'), eof), 'a') // 'a'
 * ```
 *
 * @group Primitives
 */
export const eof: Parser<null, ExpectedError> = (input, pos) =>
  pos >= input.length ? ok(pos, null) : err(pos, new ExpectedError(pos, 'end of input'))

/**
 * Match a single character passing `pred`. A type-guard predicate narrows the
 * result value (e.g. `(c): c is Digit => ...`); `char` is the equality special case.
 *
 * @example
 * ```ts
 * const lower = satisfy((c) => c >= 'a' && c <= 'z', 'lowercase')
 * parse(lower, 'x') // 'x'
 * ```
 *
 * @group Primitives
 */
export function satisfy<C extends string>(pred: (c: string) => c is C, expected?: string): Parser<C, ExpectedError>
export function satisfy(pred: (c: string) => boolean, expected?: string): Parser<string, ExpectedError>
export function satisfy(pred: (c: string) => boolean, expected = 'character'): Parser<string, ExpectedError> {
  return function satisfy(input, pos) {
    const c = input[pos]
    return c !== undefined && pred(c) ? ok(pos + 1, c) : err(pos, new ExpectedError(pos, expected))
  }
}

/**
 * Match any single character contained in `chars`.
 *
 * @example
 * ```ts
 * parse(oneOf('+-'), '-') // '-'
 * ```
 *
 * @group Primitives
 */
export const oneOf = <S extends string>(chars: S): Parser<Chars<S>, ExpectedError> =>
  satisfy((c): c is Chars<S> => chars.includes(c), `one of "${chars}"`)

/**
 * Match any single character NOT contained in `chars`.
 *
 * @example
 * ```ts
 * parse(noneOf('"'), 'a') // 'a'
 * ```
 *
 * @group Primitives
 */
export const noneOf = (chars: string): Parser<string, ExpectedError> =>
  satisfy((c) => !chars.includes(c), `none of "${chars}"`)

/**
 * Match a single decimal digit `0`–`9`.
 *
 * @example
 * ```ts
 * parse(digit, '7') // '7'
 * ```
 *
 * @group Primitives
 */
export const digit: Parser<Digit, ExpectedError> = satisfy((c): c is Digit => c >= '0' && c <= '9', 'digit')

/**
 * Match a single ASCII letter `a`–`z` or `A`–`Z`.
 *
 * @example
 * ```ts
 * parse(letter, 'Q') // 'Q'
 * ```
 *
 * @group Primitives
 */
export const letter: Parser<Letter, ExpectedError> = satisfy(
  (c): c is Letter => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'),
  'letter',
)

// ---- combinators ----

/**
 * Transform a successful value with `f`, leaving failures untouched.
 *
 * @example
 * ```ts
 * parse(map(digit, Number), '5') // 5
 * ```
 *
 * @group Combinators
 */
export const map = <A, B, E = Error>(p: Parser<A, E>, f: (a: A) => B): Parser<B, E> =>
  function map(input, pos) {
    const r = p(input, pos)
    return r.ok ? ok(r.pos, f(r.value)) : r
  }

/**
 * Context-sensitive sequencing: the next parser depends on the value just parsed.
 *
 * @example
 * ```ts
 * // parse a digit, then require that many 'x' characters
 * parse(chain(digit, (n) => count(Number(n), char('x'))), '2xx') // ['x', 'x']
 * ```
 *
 * @group Combinators
 */
export const chain = <A, B, E1, E2>(p: Parser<A, E1>, f: (a: A) => Parser<B, E2>): Parser<B, E1 | E2> =>
  function chain(input, pos) {
    const r = p(input, pos)
    return r.ok ? f(r.value)(input, r.pos) : r
  }

/**
 * Alias for {@link chain}.
 *
 * @example
 * ```ts
 * parse(flatMap(digit, (n) => pure(Number(n) * 2)), '4') // 8
 * ```
 *
 * @group Combinators
 */
export const flatMap = chain

/**
 * Run parsers in order, collecting each value into a typed tuple.
 *
 * @example
 * ```ts
 * parse(seq(char('a'), char('b')), 'ab') // ['a', 'b']
 * ```
 *
 * @group Combinators
 */
export const seq = <T extends Parser<any, any>[]>(
  ...ps: T
): Parser<{ [K in keyof T]: InferOk<T[K]> }, { [K in keyof T]: InferErr<T[K]> }[number]> =>
  function seq(input, pos) {
    const out: any[] = []
    let cur = pos
    for (let i = 0; i < ps.length; i++) {
      const r = ps[i]!(input, cur)
      if (!r.ok) return r
      out.push(r.value)
      cur = r.pos
    }
    return ok(cur, out as any)
  }

/**
 * Try each parser at the same offset, returning the first success. On failure,
 * returns the deepest error; a branch committed by `cut` stops backtracking.
 *
 * @example
 * ```ts
 * parse(alt(char('a'), char('b')), 'b') // 'b'
 * ```
 *
 * @group Combinators
 */
export const alt = <const P extends Parser<any, any>[]>(...ps: P): UnionParser<P> =>
  function alt(input, pos) {
    let furthest: Err<any> | undefined
    for (let i = 0; i < ps.length; i++) {
      const r = ps[i]!(input, pos)
      if (r.ok) return r
      if (r.fatal) return r // committed by `cut`: don't backtrack
      if (!furthest || r.pos > furthest.pos) furthest = r // first equally-deep failure wins
    }
    return furthest ?? err(pos, new ExpectedError(pos, 'no alternatives'))
  }

/**
 * Array form of {@link alt}.
 *
 * @example
 * ```ts
 * parse(choice([char('a'), char('b'), char('c')]), 'c') // 'c'
 * ```
 *
 * @group Combinators
 */
export const choice = <const P extends Parser<any, any>[]>(ps: P): UnionParser<P> => alt(...ps)

/**
 * Apply `p` zero or more times, collecting the values. Always succeeds.
 *
 * @example
 * ```ts
 * parse(many(digit), '123') // ['1', '2', '3']
 * ```
 *
 * @group Combinators
 */
export const many = <T>(p: Parser<T, any>): Parser<T[], never> =>
  function many(input, pos) {
    const out: T[] = []
    let cur = pos
    while (true) {
      const r = p(input, cur)
      if (!r.ok) break
      if (r.pos === cur) break // guard against zero-width infinite loop
      out.push(r.value)
      cur = r.pos
    }
    return ok(cur, out)
  }

/**
 * Apply `p` one or more times, returning a non-empty array.
 *
 * @example
 * ```ts
 * parse(many1(digit), '42') // ['4', '2']
 * ```
 *
 * @group Combinators
 */
export const many1 = <T, E = Error>(p: Parser<T, E>): Parser<NonEmpty<T>, E> =>
  map(seq(p, many(p)), ([head, tail]) => [head, ...tail])

/**
 * Apply `p` optionally, yielding its value or `null`. Always succeeds.
 *
 * @example
 * ```ts
 * parse(opt(char('a')), '') // null
 * ```
 *
 * @group Combinators
 */
export const opt = <T>(p: Parser<T, any>): Parser<T | null, never> =>
  function opt(input, pos) {
    const r = p(input, pos)
    return r.ok ? r : ok(pos, null)
  }

/**
 * Apply `p` exactly `n` times. A literal `n` yields a fixed-length tuple type.
 *
 * @example
 * ```ts
 * parse(count(3, digit), '123') // ['1', '2', '3']
 * ```
 *
 * @group Combinators
 */
export const count = <T, E, N extends number = number>(n: N, p: Parser<T, E>): Parser<Tuple<T, N>, E> =>
  function count(input, pos) {
    const out: T[] = []
    let cur = pos
    for (let i = 0; i < n; i++) {
      const r = p(input, cur)
      if (!r.ok) return r
      out.push(r.value)
      cur = r.pos
    }
    return ok(cur, out as Tuple<T, N>)
  }

/**
 * Apply `p` until `end` matches; consumes `end` and returns the collected values.
 *
 * @example
 * ```ts
 * parse(manyTill(letter, char('.')), 'abc.') // ['a', 'b', 'c']
 * ```
 *
 * @group Combinators
 */
export const manyTill = <T, E>(p: Parser<T, E>, end: Parser<any, any>): Parser<T[], E> =>
  function manyTill(input, pos) {
    const out: T[] = []
    let cur = pos
    while (true) {
      const e = end(input, cur)
      if (e.ok) return ok(e.pos, out)
      const r = p(input, cur)
      if (!r.ok) return r
      if (r.pos === cur) return ok(cur, out) // zero-width; stop to avoid infinite loop
      out.push(r.value)
      cur = r.pos
    }
  }

/**
 * Run `open`, `p`, `close` in order, keeping only the middle value.
 *
 * @example
 * ```ts
 * parse(between(char('('), digit, char(')')), '(5)') // '5'
 * ```
 *
 * @group Combinators
 */
export const between = <O, T, C, Eo, Ep, Ec>(
  open: Parser<O, Eo>,
  p: Parser<T, Ep>,
  close: Parser<C, Ec>,
): Parser<T, Eo | Ep | Ec> => map(seq(open, p, close), ([, v]) => v)

/**
 * Run both `a` and `b`, keeping the left value (`<*`).
 *
 * @example
 * ```ts
 * parse(left(digit, char(';')), '5;') // '5'
 * ```
 *
 * @group Combinators
 */
export const left = <A, B, Ea, Eb>(a: Parser<A, Ea>, b: Parser<B, Eb>): Parser<A, Ea | Eb> => map(seq(a, b), ([x]) => x)

/**
 * Run both `a` and `b`, keeping the right value (`*>`).
 *
 * @example
 * ```ts
 * parse(right(char('$'), digit), '$5') // '5'
 * ```
 *
 * @group Combinators
 */
export const right = <A, B, Ea, Eb>(a: Parser<A, Ea>, b: Parser<B, Eb>): Parser<B, Ea | Eb> =>
  map(seq(a, b), ([, y]) => y)

/**
 * Parse `p` separated by `sep`: `p (sep p)*`. Always succeeds (empty yields `[]`).
 *
 * @example
 * ```ts
 * parse(sepBy(digit, char(',')), '1,2,3') // ['1', '2', '3']
 * ```
 *
 * @group Combinators
 */
export const sepBy = <T, S>(p: Parser<T, any>, sep: Parser<S, any>): Parser<T[], never> =>
  map(opt(seq(p, many(map(seq(sep, p), ([, v]) => v)))), (r) => (r ? [r[0], ...r[1]] : []))

/**
 * Like {@link sepBy} but requires at least one element; propagates the first
 * element's error.
 *
 * @example
 * ```ts
 * parse(sepBy1(digit, char(',')), '1,2') // ['1', '2']
 * ```
 *
 * @group Combinators
 */
export const sepBy1 = <T, E>(p: Parser<T, E>, sep: Parser<any, any>): Parser<NonEmpty<T>, E> =>
  map(seq(p, many(right(sep, p))), ([head, tail]) => [head, ...tail])

/**
 * Like {@link sepBy} but allows an optional trailing separator.
 *
 * @example
 * ```ts
 * parse(sepEndBy(digit, char(',')), '1,2,') // ['1', '2']
 * ```
 *
 * @group Combinators
 */
export const sepEndBy = <T, S>(p: Parser<T, any>, sep: Parser<S, any>): Parser<T[], never> =>
  left(sepBy(p, sep), opt(sep))

/**
 * Run `p` but discard its result, yielding `null`. Useful for whitespace.
 *
 * @example
 * ```ts
 * parse(skip(whitespace), '   ') // null
 * ```
 *
 * @group Combinators
 */
export const skip = <T, E>(p: Parser<T, E>): Parser<null, E> => map(p, () => null)

/**
 * Always succeed with `value`, consuming nothing.
 *
 * @example
 * ```ts
 * parse(pure(42), '') // 42
 * ```
 *
 * @group Combinators
 */
export const pure =
  <T>(value: T): Parser<T, never> =>
  (_input, pos) =>
    ok(pos, value)

/**
 * Always fail with message `msg`.
 *
 * @example
 * ```ts
 * parse(failParser('unreachable'), '') // throws ExpectedError
 * ```
 *
 * @group Combinators
 */
export const failParser =
  (msg: string): Parser<never, ExpectedError> =>
  (_input, pos) =>
    err(pos, new ExpectedError(pos, msg))

/**
 * Zero-width lookahead: match `p` but rewind to the start, keeping its value.
 *
 * @example
 * ```ts
 * peek(char('a'))('abc', 0) // { ok: true, value: 'a', pos: 0 }
 * ```
 *
 * @group Combinators
 */
export const peek = <T, E>(p: Parser<T, E>): Parser<T, E> =>
  function peek(input, pos) {
    const r = p(input, pos)
    return r.ok ? ok(pos, r.value) : r
  }

/**
 * Zero-width assertion that `p` matches ahead, consuming nothing.
 *
 * @example
 * ```ts
 * parse(seq(followedBy(char('a')), char('a')), 'a') // [null, 'a']
 * ```
 *
 * @group Combinators
 */
export const followedBy = <T, E>(p: Parser<T, E>): Parser<null, E> => skip(peek(p))

/**
 * Zero-width assertion that `p` does NOT match ahead, consuming nothing.
 *
 * @example
 * ```ts
 * parse(seq(notFollowedBy(char('b')), char('a')), 'a') // [null, 'a']
 * ```
 *
 * @group Combinators
 */
export const notFollowedBy = <T>(p: Parser<T, any>): Parser<null, ExpectedError> =>
  function notFollowedBy(input, pos) {
    return p(input, pos).ok ? err(pos, new ExpectedError(pos, 'unexpected input')) : ok(pos, null)
  }

/**
 * Commit: once `p` fails, mark the failure fatal so `alt` stops backtracking.
 *
 * @example
 * ```ts
 * // 'b' won't be tried because the 'a' branch is committed after '('
 * alt(right(char('('), cut(char('a'))), char('b'))('(x', 0) // fatal Err
 * ```
 *
 * @group Combinators
 */
export const cut = <T, E>(p: Parser<T, E>): Parser<T, E> =>
  function cut(input, pos) {
    const r = p(input, pos)
    return r.ok ? r : { ...r, fatal: true }
  }

/**
 * Replace a parser's failure message with `name` (better errors for tooling).
 *
 * @example
 * ```ts
 * parse(label(digit, 'a digit'), 'x') // throws "expected a digit"
 * ```
 *
 * @group Combinators
 */
export const label = <T, E>(p: Parser<T, E>, name: string): Parser<T, ExpectedError> =>
  function label(input, pos) {
    const r = p(input, pos)
    return r.ok ? r : err(r.pos, new ExpectedError(r.pos, name))
  }

/**
 * A value paired with its source span `[start, end)`.
 *
 * @example
 * ```ts
 * const s: Span<string> = { value: 'a', start: 0, end: 1 }
 * ```
 */
export interface Span<T> {
  value: T
  start: number
  end: number
}

/**
 * Annotate `p`'s value with its source span (for editor tooling).
 *
 * @example
 * ```ts
 * parse(withPos(digit), '5') // { value: '5', start: 0, end: 1 }
 * ```
 *
 * @group Combinators
 */
export const withPos = <T, E>(p: Parser<T, E>): Parser<Span<T>, E> =>
  function withPos(input, pos) {
    const r = p(input, pos)
    return r.ok ? ok(r.pos, { value: r.value, start: pos, end: r.pos }) : r
  }

/**
 * Zero-width parser that yields the current offset.
 *
 * @example
 * ```ts
 * parse(right(char('a'), getPos), 'a') // 1
 * ```
 *
 * @group Combinators
 */
export const getPos: Parser<number, never> = (_input, pos) => ok(pos, pos)

/**
 * Defer construction of a parser, breaking recursive definitions. The factory
 * `f` runs at most once and the result is cached.
 *
 * @example
 * ```ts
 * const expr: Parser<string, any> = lazy(() => alt(char('a'), right(char('('), left(expr, char(')')))))
 * parse(expr, '((a))') // 'a'
 * ```
 *
 * @group Combinators
 */
export const lazy = <T, E = Error>(f: () => Parser<T, E>): Parser<T, E> => {
  let cached: Parser<T, E> | null = null
  return function lazy(input, pos) {
    return (cached ??= f())(input, pos)
  }
}

/**
 * Top-level driver: run `p`, require full consumption, and throw on failure.
 *
 * @example
 * ```ts
 * parse(many1(digit), '123') // ['1', '2', '3']
 * ```
 *
 * @group Running
 */
export const parse = <T, E>(p: Parser<T, E>, input: string): T => {
  const r = seq(p, eof)(input, 0)
  if (r.ok) return r.value[0]
  if (r.error instanceof Error) throw r.error
  throw new Error(`Parse error at ${r.pos}${r.error === undefined ? '' : `: ${String(r.error)}`}`)
}

/**
 * Match a double-quoted string literal, stripping backslash escapes (e.g. `\"`
 * -> `"`). Does not interpret `\n`, `\t` as control chars.
 *
 * @example
 * ```ts
 * parse(stringLit, '"he\\"llo"') // 'he"llo'
 * ```
 *
 * @group Lexers
 */
export const stringLit: Parser<string, ExpectedError> = map(regex(/"(?:\\.|[^"\\])*"/, 'string literal'), (raw) =>
  raw.slice(1, -1).replace(/\\(.)/g, '$1'),
)

/**
 * Match a (possibly signed, possibly fractional) number literal.
 *
 * @example
 * ```ts
 * parse(numberLit, '-3.14') // -3.14
 * ```
 *
 * @group Lexers
 */
export const numberLit: Parser<number, ExpectedError> = map(regex(/-?\d+(?:\.\d+)?/, 'number'), Number)

/**
 * Match a (possibly signed) integer literal.
 *
 * @example
 * ```ts
 * parse(intLit, '-42') // -42
 * ```
 *
 * @group Lexers
 */
export const intLit: Parser<number, ExpectedError> = map(regex(/-?\d+/, 'integer'), Number)

/**
 * Match an identifier: a leading letter or `_`, then letters, digits, or `_`.
 *
 * @example
 * ```ts
 * parse(identifier, 'foo_1') // 'foo_1'
 * ```
 *
 * @group Lexers
 */
export const identifier: Parser<string, ExpectedError> = regex(/[A-Za-z_][A-Za-z0-9_]*/, 'identifier')

/**
 * Match zero or more whitespace characters.
 *
 * @example
 * ```ts
 * parse(map(whitespace, (s) => s.length), '  \t') // 3
 * ```
 *
 * @group Lexers
 */
export const whitespace: Parser<string, ExpectedError> = regex(/\s*/u, 'whitespace')

/**
 * Lexeme style: match `p`, then consume trailing whitespace.
 *
 * @example
 * ```ts
 * parse(seq(token(identifier), identifier), 'foo  bar') // ['foo', 'bar']
 * ```
 *
 * @group Lexers
 */
export const token = <T, E>(p: Parser<T, E>): Parser<T, E | ExpectedError> => map(seq(p, whitespace), ([v]) => v)

/**
 * Alias for {@link token}.
 *
 * @example
 * ```ts
 * parse(lexeme(intLit), '7   ') // 7
 * ```
 *
 * @group Lexers
 */
export const lexeme = token

/**
 * A fixed-string token (e.g. punctuation/operators), consuming trailing whitespace.
 *
 * @example
 * ```ts
 * parse(seq(symbol('('), symbol(')')), '(  )') // ['(', ')']
 * ```
 *
 * @group Lexers
 */
export const symbol = <S extends string>(s: S): Parser<S, ExpectedError> => token(str(s))

/**
 * Match keyword `s` not immediately followed by an identifier char (avoids
 * matching `in` inside `input`).
 *
 * @example
 * ```ts
 * parse(keyword('in'), 'in') // 'in'
 * keyword('in')('input', 0) // Err (not a standalone keyword)
 * ```
 *
 * @group Lexers
 */
export const keyword = <S extends string>(s: S): Parser<S, ExpectedError> =>
  left(str(s), notFollowedBy(regex(/[A-Za-z0-9_]/)))

/**
 * Error carrying the failure offset `pos` and a human-readable `expected` description.
 *
 * @example
 * ```ts
 * new ExpectedError(0, 'digit').message // 'Parse error at 0: expected digit'
 * ```
 *
 * @group Errors
 */
export class ExpectedError extends Error {
  constructor(
    public pos: number,
    public expected: string,
  ) {
    super(`Parse error at ${pos}: expected ${expected}`)
  }
}

// ---------------- Utility Types ----------------

/**
 * The union of decimal digit characters `'0'`–`'9'`.
 *
 * @example
 * ```ts
 * const d: Digit = '7'
 * ```
 */
export type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'

/**
 * The union of ASCII letter characters `'A'`–`'Z'` and `'a'`–`'z'`.
 *
 * @example
 * ```ts
 * const l: Letter = 'Q'
 * ```
 */
export type Letter =
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'H'
  | 'I'
  | 'J'
  | 'K'
  | 'L'
  | 'M'
  | 'N'
  | 'O'
  | 'P'
  | 'Q'
  | 'R'
  | 'S'
  | 'T'
  | 'U'
  | 'V'
  | 'W'
  | 'X'
  | 'Y'
  | 'Z'
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e'
  | 'f'
  | 'g'
  | 'h'
  | 'i'
  | 'j'
  | 'k'
  | 'l'
  | 'm'
  | 'n'
  | 'o'
  | 'p'
  | 'q'
  | 'r'
  | 's'
  | 't'
  | 'u'
  | 'v'
  | 'w'
  | 'x'
  | 'y'
  | 'z'

/**
 * Split a string-literal type into a union of its characters; `string` stays `string`.
 *
 * @example
 * ```ts
 * type T = Chars<'ab'> // 'a' | 'b'
 * ```
 */
export type Chars<S extends string> = string extends S
  ? string
  : S extends `${infer H}${infer T}`
    ? H | Chars<T>
    : never

/**
 * A non-empty array: at least one element.
 *
 * @example
 * ```ts
 * const xs: NonEmpty<number> = [1, 2, 3]
 * ```
 */
export type NonEmpty<T> = [T, ...T[]]

/**
 * A fixed-length tuple of `T`; falls back to `T[]` when `N` isn't a literal.
 *
 * @example
 * ```ts
 * type T = Tuple<string, 2> // [string, string]
 * ```
 */
export type Tuple<T, N extends number, Acc extends T[] = []> = number extends N
  ? T[]
  : Acc['length'] extends N
    ? Acc
    : Tuple<T, N, [...Acc, T]>

// ---------------- parser-shape inference ----------------
type InferErr<P> = P extends Parser<any, infer E> ? E : never
type InferOk<P> = P extends Parser<infer T, any> ? T : never
type UnionParser<P extends Parser<any, any>[]> = Parser<
  { [K in keyof P]: InferOk<P[K]> }[number],
  { [K in keyof P]: InferErr<P[K]> }[number]
>
