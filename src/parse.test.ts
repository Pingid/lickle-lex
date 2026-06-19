import { test, expect, describe, expectTypeOf } from 'vitest'
import * as P from './index.js'

// run a parser from the start and return the raw Result
const run = <T>(p: P.Parser<T, any>, input: string) => p(input, 0)

describe('primitives', () => {
  test('char matches a single character and advances pos', () => {
    expect(run(P.char('a'), 'abc')).toEqual({ ok: true, value: 'a', pos: 1 })
  })

  test('char fails on mismatch without advancing', () => {
    const r = run(P.char('a'), 'xyz')
    expect(r.ok).toBe(false)
    expect(r.pos).toBe(0)
    expect((r as P.Err<P.ExpectedError>).error).toBeInstanceOf(P.ExpectedError)
  })

  test('char fails at end of input', () => {
    expect(run(P.char('a'), '').ok).toBe(false)
  })

  test('str matches a prefix and advances by its length', () => {
    expect(run(P.str('foo'), 'foobar')).toEqual({ ok: true, value: 'foo', pos: 3 })
  })

  test('str respects the starting offset', () => {
    expect(P.str('bar')('foobar', 3)).toEqual({ ok: true, value: 'bar', pos: 6 })
  })

  test('str fails on a partial match', () => {
    expect(run(P.str('foo'), 'fo').ok).toBe(false)
  })

  test('regex matches anchored at pos (sticky)', () => {
    expect(run(P.regex(/\d+/), '123abc')).toEqual({ ok: true, value: '123', pos: 3 })
  })

  test('regex does not skip ahead to find a match', () => {
    expect(run(P.regex(/\d+/), 'abc123').ok).toBe(false)
  })

  test('regex uses the custom expected label on failure', () => {
    const r = run(P.regex(/\d+/, 'digits'), 'x')
    expect((r as P.Err<P.ExpectedError>).error?.expected).toBe('digits')
  })

  test('regex preserves input flags (e.g. case-insensitive)', () => {
    expect(run(P.regex(/abc/i), 'ABC')).toEqual({ ok: true, value: 'ABC', pos: 3 })
  })

  test('eof succeeds at the end of input', () => {
    expect(P.eof('abc', 3)).toEqual({ ok: true, value: null, pos: 3 })
  })

  test('eof fails when input remains', () => {
    expect(P.eof('abc', 1).ok).toBe(false)
  })
})

describe('map', () => {
  test('transforms a successful value', () => {
    expect(run(P.map(P.char('5'), Number), '5')).toEqual({ ok: true, value: 5, pos: 1 })
  })

  test('passes failures through untouched', () => {
    expect(
      run(
        P.map(P.char('a'), () => 1),
        'b',
      ).ok,
    ).toBe(false)
  })
})

describe('seq', () => {
  test('collects results into a tuple', () => {
    expect(run(P.seq(P.char('a'), P.char('b')), 'ab')).toEqual({ ok: true, value: ['a', 'b'], pos: 2 })
  })

  test('fails and reports the failing position', () => {
    const r = run(P.seq(P.char('a'), P.char('b')), 'ax')
    expect(r.ok).toBe(false)
    expect(r.pos).toBe(1)
  })
})

describe('alt', () => {
  test('returns the first matching branch', () => {
    expect(run(P.alt(P.char('a'), P.char('b')), 'b')).toEqual({ ok: true, value: 'b', pos: 1 })
  })

  test('fails when no branch matches', () => {
    expect(run(P.alt(P.char('a'), P.char('b')), 'c').ok).toBe(false)
  })

  test('reports the deepest failure', () => {
    const r = run(P.alt(P.str('xy'), P.seq(P.char('x'), P.char('z'))), 'xq')
    expect(r.ok).toBe(false)
    expect(r.pos).toBe(1) // the seq branch consumed 'x' before failing
  })
})

describe('many', () => {
  test('matches zero occurrences', () => {
    expect(run(P.many(P.char('a')), 'bbb')).toEqual({ ok: true, value: [], pos: 0 })
  })

  test('matches repeated occurrences', () => {
    expect(run(P.many(P.char('a')), 'aaab')).toEqual({ ok: true, value: ['a', 'a', 'a'], pos: 3 })
  })

  test('does not loop forever on a zero-width parser', () => {
    expect(run(P.many(P.regex(/a*/)), 'b')).toEqual({ ok: true, value: [], pos: 0 })
  })
})

describe('many1', () => {
  test('requires at least one match', () => {
    expect(run(P.many1(P.char('a')), 'b').ok).toBe(false)
  })

  test('collects one or more matches', () => {
    expect(run(P.many1(P.char('a')), 'aa')).toEqual({ ok: true, value: ['a', 'a'], pos: 2 })
  })
})

describe('opt', () => {
  test('returns the value when present', () => {
    expect(run(P.opt(P.char('a')), 'a')).toEqual({ ok: true, value: 'a', pos: 1 })
  })

  test('returns null without consuming when absent', () => {
    expect(run(P.opt(P.char('a')), 'b')).toEqual({ ok: true, value: null, pos: 0 })
  })
})

describe('between', () => {
  test('keeps only the inner result', () => {
    const p = P.between(P.char('('), P.regex(/\w+/), P.char(')'))
    expect(run(p, '(hi)')).toEqual({ ok: true, value: 'hi', pos: 4 })
  })

  test('fails when a delimiter is missing', () => {
    const p = P.between(P.char('('), P.regex(/\w+/), P.char(')'))
    expect(run(p, '(hi').ok).toBe(false)
  })
})

describe('sepBy', () => {
  const list = P.sepBy(P.regex(/\d+/), P.char(','))

  test('parses an empty list', () => {
    expect(run(list, '')).toEqual({ ok: true, value: [], pos: 0 })
  })

  test('parses a single element', () => {
    expect(run(list, '1')).toEqual({ ok: true, value: ['1'], pos: 1 })
  })

  test('parses multiple separated elements', () => {
    expect(run(list, '1,2,3')).toEqual({ ok: true, value: ['1', '2', '3'], pos: 5 })
  })

  test('stops at a trailing separator', () => {
    const r = run(list, '1,2,')
    expect(r.ok).toBe(true)
    expect((r as P.Ok<string[]>).value).toEqual(['1', '2'])
    expect(r.pos).toBe(3)
  })
})

describe('skip', () => {
  test('discards the value but advances pos', () => {
    expect(run(P.skip(P.str('ab')), 'abc')).toEqual({ ok: true, value: null, pos: 2 })
  })
})

describe('lazy', () => {
  test('defers construction and only builds once', () => {
    let calls = 0
    const p = P.lazy(() => {
      calls++
      return P.char('a')
    })
    expect(run(p, 'a').ok).toBe(true)
    expect(run(p, 'a').ok).toBe(true)
    expect(calls).toBe(1)
  })

  test('supports recursive grammars', () => {
    // nested: '(' nested ')' | 'x'
    const nested: P.Parser<unknown> = P.alt(
      P.between(
        P.char('('),
        P.lazy(() => nested),
        P.char(')'),
      ),
      P.char('x'),
    )
    expect(P.parse(nested, '((x))')).toBeDefined()
  })
})

describe('parse', () => {
  test('returns the value on full consumption', () => {
    expect(P.parse(P.regex(/\d+/), '123')).toBe('123')
  })

  test('throws when input is not fully consumed', () => {
    expect(() => P.parse(P.char('a'), 'ab')).toThrow()
  })

  test('throws the underlying ExpectedError on failure', () => {
    expect(() => P.parse(P.char('a'), 'b')).toThrow(P.ExpectedError)
  })
})

describe('literals and tokens', () => {
  test('numberLit parses integers and decimals', () => {
    expect(P.parse(P.numberLit, '42')).toBe(42)
    expect(P.parse(P.numberLit, '-3.14')).toBe(-3.14)
  })

  test('stringLit strips quotes and backslash escapes', () => {
    expect(P.parse(P.stringLit, '"hello"')).toBe('hello')
    expect(P.parse(P.stringLit, '"a\\"b"')).toBe('a"b')
  })

  test('stringLit does not interpret control escapes (\\n -> literal n)', () => {
    expect(P.parse(P.stringLit, '"a\\nb"')).toBe('anb')
  })

  test('token consumes trailing whitespace only', () => {
    expect(run(P.token(P.str('hi')), 'hi  ')).toEqual({ ok: true, value: 'hi', pos: 4 })
  })

  test('token does not consume leading whitespace', () => {
    expect(run(P.token(P.str('hi')), '  hi').ok).toBe(false)
  })
})

describe('char predicates', () => {
  test('satisfy matches a predicate', () => {
    expect(run(P.satisfy((c) => c === 'z'), 'z')).toEqual({ ok: true, value: 'z', pos: 1 })
  })

  test('satisfy fails at end of input', () => {
    expect(run(P.satisfy(() => true), '').ok).toBe(false)
  })

  test('oneOf / noneOf', () => {
    expect(run(P.oneOf('abc'), 'b').ok).toBe(true)
    expect(run(P.oneOf('abc'), 'd').ok).toBe(false)
    expect(run(P.noneOf('abc'), 'd').ok).toBe(true)
    expect(run(P.noneOf('abc'), 'a').ok).toBe(false)
  })

  test('digit', () => {
    expect(run(P.digit, '7')).toEqual({ ok: true, value: '7', pos: 1 })
    expect(run(P.digit, 'x').ok).toBe(false)
  })
})

describe('chain', () => {
  test('feeds the prior value into the next parser', () => {
    // parse a digit n, then exactly n 'a's
    const p = P.chain(P.map(P.digit, Number), (n) => P.count(n, P.char('a')))
    expect(P.parse(p, '3aaa')).toEqual(['a', 'a', 'a'])
    expect(() => P.parse(p, '3aa')).toThrow()
  })

  test('flatMap is an alias of chain', () => {
    expect(P.flatMap).toBe(P.chain)
  })
})

describe('lookahead', () => {
  test('peek matches without consuming', () => {
    expect(run(P.peek(P.str('ab')), 'abc')).toEqual({ ok: true, value: 'ab', pos: 0 })
  })

  test('followedBy asserts without consuming', () => {
    expect(run(P.followedBy(P.char('a')), 'abc')).toEqual({ ok: true, value: null, pos: 0 })
    expect(run(P.followedBy(P.char('a')), 'xyz').ok).toBe(false)
  })

  test('notFollowedBy is the negation', () => {
    expect(run(P.notFollowedBy(P.char('a')), 'xyz')).toEqual({ ok: true, value: null, pos: 0 })
    expect(run(P.notFollowedBy(P.char('a')), 'abc').ok).toBe(false)
  })

  test('keyword does not match inside a longer identifier', () => {
    expect(P.parse(P.keyword('in'), 'in')).toBe('in')
    expect(run(P.keyword('in'), 'input').ok).toBe(false)
  })
})

describe('cut and label', () => {
  test('cut commits, preventing alt from trying later branches', () => {
    const committed = P.right(P.char('('), P.cut(P.char('a')))
    const p = P.alt(committed, P.str('(b'))
    // without cut the second branch would match '(b'; cut makes the failure fatal
    expect(run(p, '(b').ok).toBe(false)
  })

  test('label replaces the failure message', () => {
    const r = run(P.label(P.digit, 'a number'), 'x')
    expect((r as P.Err<P.ExpectedError>).error?.expected).toBe('a number')
  })
})

describe('list combinators', () => {
  const nums = (p: P.Parser<string[], any>, s: string) => (run(p, s) as P.Ok<string[]>).value

  test('sepBy1 requires at least one element', () => {
    expect(run(P.sepBy1(P.digit, P.char(',')), 'x').ok).toBe(false)
    expect(nums(P.sepBy1(P.digit, P.char(',')), '1,2,3')).toEqual(['1', '2', '3'])
  })

  test('sepEndBy allows an optional trailing separator', () => {
    expect(nums(P.sepEndBy(P.digit, P.char(',')), '1,2,3')).toEqual(['1', '2', '3'])
    expect(nums(P.sepEndBy(P.digit, P.char(',')), '1,2,3,')).toEqual(['1', '2', '3'])
    expect(nums(P.sepEndBy(P.digit, P.char(',')), '')).toEqual([])
  })

  test('manyTill repeats until the end parser matches', () => {
    const p = P.manyTill(P.satisfy(() => true), P.char('*'))
    expect(run(p, 'abc*')).toEqual({ ok: true, value: ['a', 'b', 'c'], pos: 4 })
  })

  test('count requires exactly n', () => {
    expect(run(P.count(2, P.char('a')), 'aa')).toEqual({ ok: true, value: ['a', 'a'], pos: 2 })
    expect(run(P.count(2, P.char('a')), 'a').ok).toBe(false)
  })
})

describe('pairs and constants', () => {
  test('left keeps the first value', () => {
    expect(run(P.left(P.digit, P.char(';')), '5;')).toEqual({ ok: true, value: '5', pos: 2 })
  })

  test('right keeps the second value', () => {
    expect(run(P.right(P.char('$'), P.digit), '$5')).toEqual({ ok: true, value: '5', pos: 2 })
  })

  test('pure succeeds without consuming', () => {
    expect(run(P.pure(42), 'abc')).toEqual({ ok: true, value: 42, pos: 0 })
  })

  test('failParser always fails', () => {
    expect(run(P.failParser('nope'), 'abc').ok).toBe(false)
  })

  test('choice is the array form of alt', () => {
    expect(run(P.choice([P.char('a'), P.char('b')]), 'b')).toEqual({ ok: true, value: 'b', pos: 1 })
  })
})

describe('positions and tokens', () => {
  test('withPos annotates the source span', () => {
    expect(run(P.withPos(P.str('hi')), 'hi!')).toEqual({
      ok: true,
      value: { value: 'hi', start: 0, end: 2 },
      pos: 2,
    })
  })

  test('getPos yields the current offset', () => {
    expect(P.right(P.str('ab'), P.getPos)('abc', 0)).toEqual({ ok: true, value: 2, pos: 2 })
  })

  test('symbol matches a fixed string and eats trailing whitespace', () => {
    expect(run(P.symbol('=>'), '=>  x')).toEqual({ ok: true, value: '=>', pos: 4 })
  })

  test('intLit / identifier', () => {
    expect(P.parse(P.intLit, '-12')).toBe(-12)
    expect(P.parse(P.identifier, 'foo_bar1')).toBe('foo_bar1')
  })
})

describe('static types', () => {
  test('char / str preserve string literals', () => {
    expectTypeOf(P.parse(P.char('x'), 'x')).toEqualTypeOf<'x'>()
    expectTypeOf(P.parse(P.str('foo'), 'foo')).toEqualTypeOf<'foo'>()
  })

  test('oneOf narrows to a union of its characters', () => {
    expectTypeOf(P.parse(P.oneOf('abc'), 'a')).toEqualTypeOf<'a' | 'b' | 'c'>()
  })

  test('digit / letter narrow via type-guard satisfy', () => {
    expectTypeOf(P.parse(P.digit, '1')).toEqualTypeOf<P.Digit>()
    expectTypeOf(P.parse(P.letter, 'a')).toEqualTypeOf<P.Letter>()
  })

  test('satisfy narrows when given a type guard', () => {
    const p = P.satisfy((c): c is 'a' | 'b' => c === 'a' || c === 'b')
    expectTypeOf(P.parse(p, 'a')).toEqualTypeOf<'a' | 'b'>()
  })

  test('many1 / sepBy1 yield non-empty tuples', () => {
    expectTypeOf(P.parse(P.many1(P.char('a')), 'a')).toEqualTypeOf<P.NonEmpty<'a'>>()
    expectTypeOf(P.parse(P.sepBy1(P.digit, P.char(',')), '1')).toEqualTypeOf<P.NonEmpty<P.Digit>>()
  })

  test('count with a literal n yields a fixed-length tuple', () => {
    expectTypeOf(P.parse(P.count(3, P.char('a')), 'aaa')).toEqualTypeOf<['a', 'a', 'a']>()
  })

  test('count with a dynamic n falls back to an array', () => {
    const n: number = 2
    expectTypeOf(P.parse(P.count(n, P.char('a')), 'aa')).toEqualTypeOf<'a'[]>()
  })

  test('symbol / keyword preserve the literal', () => {
    expectTypeOf(P.parse(P.symbol('=>'), '=>')).toEqualTypeOf<'=>'>()
    expectTypeOf(P.parse(P.keyword('let'), 'let')).toEqualTypeOf<'let'>()
  })

  test('seq yields a positional tuple, alt yields a union', () => {
    expectTypeOf(P.parse(P.seq(P.char('a'), P.digit), 'a1')).toEqualTypeOf<['a', P.Digit]>()
    expectTypeOf(P.parse(P.alt(P.char('a'), P.digit), 'a')).toEqualTypeOf<'a' | P.Digit>()
  })
})

describe('integration', () => {
  test('parses a whitespace-tolerant number array', () => {
    // lexeme-style tokens eat trailing whitespace; a leading skip handles the front
    const arr = P.between(
      P.token(P.char('[')),
      P.sepBy(P.token(P.numberLit), P.token(P.char(','))),
      P.token(P.char(']')),
    )
    const top = P.map(P.seq(P.whitespace, arr), ([, v]) => v)
    expect(P.parse(top, ' [ 1, 2, 3.5 ] ')).toEqual([1, 2, 3.5])
  })
})
