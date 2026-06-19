# @lickle/lex

A tiny, type-safe parser combinator library. Parsers are plain functions, errors are tracked in the types, and grammars compose from small atoms.

[![Build Status](https://img.shields.io/github/actions/workflow/status/Pingid/lickle-lex/test.yml?branch=main&style=flat&colorA=000000&colorB=000000)](https://github.com/Pingid/lickle-lex/actions?query=workflow:Test)
[![Build Size](https://img.shields.io/bundlephobia/minzip/@lickle/lex?label=bundle%20size&style=flat&colorA=000000&colorB=000000)](https://bundlephobia.com/result?p=@lickle/lex)
[![Version](https://img.shields.io/npm/v/@lickle/lex?style=flat&colorA=000000&colorB=000000)](https://www.npmjs.com/package/@lickle/lex)
[![Downloads](https://img.shields.io/npm/dt/@lickle/lex.svg?style=flat&colorA=000000&colorB=000000)](https://www.npmjs.com/package/@lickle/lex)

## Install

```bash
npm install @lickle/lex
```

---

## Quick Start

```ts
import * as P from '@lickle/lex'

// [ 1, 2, 3.5 ] with whitespace anywhere
const array = P.between(P.token(P.char('[')), P.sepBy(P.token(P.numberLit), P.token(P.char(','))), P.token(P.char(']')))

const top = P.right(P.whitespace, array)

P.parse(top, ' [ 1, 2, 3.5 ] ') // -> [1, 2, 3.5]
```

---

## Core Concept

A `Parser` is a function from an input string and an offset to a `Result`. On success it returns the parsed value and the next offset; on failure it returns the offset where it stopped and an optional error.

```ts
type Parser<T, E = Error> = (input: string, pos: number) => Result<T, E>

type Result<T, E = Error> = { ok: true; value: T; pos: number } | { ok: false; pos: number; error?: E; fatal?: boolean }
```

Combinators take parsers and return parsers, so grammars are built by composition. Both the value type `T` and the error type `E` flow through the types — `seq` produces a tuple, `alt` produces a union, and `many1`/`count` produce non-empty or fixed-length tuples.

Run a parser with `parse`, which requires the whole input to be consumed and throws on failure:

```ts
P.parse(P.numberLit, '42') // -> 42
P.parse(P.numberLit, '4x') // throws ExpectedError
```

---

## Primitives

Match raw input.

```ts
P.char('a') // a single character
P.str('foo') // an exact string
P.regex(/\d+/) // anchored at pos (sticky); keeps i/u/m/s flags
P.eof // assert end of input

P.satisfy((c) => c === 'z') // a char passing a predicate (narrows with a type guard)
P.oneOf('abc') // one of the given chars
P.noneOf('abc') // any char except these
P.digit // '0'..'9'
P.letter // 'a'..'z' | 'A'..'Z'
```

---

## Combinators

Sequence, choose, repeat, and transform.

```ts
P.map(p, (x) => ...)      // transform a successful value
P.chain(p, (x) => q)      // context-sensitive: next parser depends on the value (alias: flatMap)

P.seq(a, b, c)            // run in order -> [A, B, C]
P.alt(a, b, c)            // first to match wins -> A | B | C (alias: choice([...]))

P.many(p)                 // zero or more -> T[]
P.many1(p)                // one or more  -> [T, ...T[]]
P.count(3, p)             // exactly n    -> fixed-length tuple
P.opt(p)                  // T | null, consuming nothing on failure
P.manyTill(p, end)        // repeat p until end matches

P.between(open, p, close) // keep only the middle value
P.left(a, b)              // run both, keep the left  (<*)
P.right(a, b)             // run both, keep the right (*>)
P.skip(p)                 // run p, discard its value

P.sepBy(p, sep)           // zero or more, separated
P.sepBy1(p, sep)          // one or more, separated
P.sepEndBy(p, sep)        // sepBy with an optional trailing separator

P.pure(value)             // always succeed, consume nothing
P.failParser('msg')       // always fail
```

---

## Lookahead & Control

Zero-width assertions and error control.

```ts
P.peek(p) // match p but rewind, keeping its value
P.followedBy(p) // assert p matches ahead (consumes nothing)
P.notFollowedBy(p) // assert p does NOT match ahead

P.cut(p) // commit: once past, alt stops backtracking
P.label(p, 'a number') // replace p's failure message
```

`cut` is the standard tool for good error messages: once a branch has committed to a path, a later failure is reported there instead of being swallowed by `alt`.

---

## Lexing

Token-level helpers. The lexeme style matches a value then eats trailing whitespace.

```ts
P.whitespace // \s*
P.token(p) // match p, then consume trailing whitespace (alias: lexeme)
P.symbol('=>') // a fixed-string token
P.keyword('in') // a keyword not followed by an identifier char (won't match 'input')

P.stringLit // "..." with backslash escapes stripped
P.numberLit // integer or decimal -> number
P.intLit // integer -> number
P.identifier // [A-Za-z_][A-Za-z0-9_]*
```

---

## Recursion

Grammars that reference themselves are built with `lazy`, which defers construction until first use (and caches it).

```ts
// nested: '(' nested ')' | 'x'
const nested: P.Parser<unknown> = P.alt(
  P.between(
    P.char('('),
    P.lazy(() => nested),
    P.char(')'),
  ),
  P.char('x'),
)

P.parse(nested, '((x))')
```

---

## Source Positions

Annotate values with their span for editor tooling and diagnostics.

```ts
P.withPos(p) // wraps the value as { value, start, end }
P.getPos // zero-width: yields the current offset
```

---

## Errors

Failures default to `ExpectedError`, which records the offset and a human-readable `expected` label.

```ts
class ExpectedError extends Error {
  pos: number
  expected: string
}
```

`parse` throws the underlying error on failure; running a parser directly returns an `Err` you can inspect (`{ ok: false, pos, error }`).

---

## License

MIT © [Dan Beaven](https://github.com/Pingid)
