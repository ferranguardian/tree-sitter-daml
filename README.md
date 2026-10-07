# tree-sitter-daml

A [tree-sitter](https://tree-sitter.github.io) grammar for [DAML](https://docs.daml.com), the smart-contract language of
Digital Asset / Canton.

DAML is a GHC fork, so this grammar **extends tree-sitter-haskell 0.23.1** (MIT). The Haskell rule files
(`haskell-grammar.js`, `grammar/`) are vendored unchanged; DAML syntax lives in `grammar.js`, and the external scanner
(`src/scanner.c`) carries a small set of DAML patches marked `DAML:`. Haskell node names are kept for shared
constructs, so Haskell queries and extractors keep working on DAML trees. The root node is still `haskell`.

## DAML syntax covered

- `:` is the type annotation and `::` is list cons (swapped from Haskell).
- `with` blocks: `data T = T with a : Int`, `with { a : Int, b : Text }`, record construction/update
  (`create this with owner = p`), puns, `..` wildcards, comma or semicolon separators, and `with` patterns
  (`f (T with a; ..) = ...`). Record braces also accept `;` (`Transfer{newOwner; amount}`).
- `template` with `signatory`, `observer`, `ensure`, `agreement`, `key ... : T`, `maintainer`, template `let`,
  choices, `interface instance I for T where ...`, and pre-2.0 `implements` / `controller ... can`.
- Choices: `nonconsuming`/`preconsuming`/`postconsuming`, `with` parameters, `controller`/`observer`/`authority`
  clauses (inline or in a `where` block), `do` body.
- `interface I requires J where` with `viewtype`, method signatures, choices and interface instances.
- `exception E with ... where message ...`.
- `try ... catch` alternatives.

DAML clause keywords (`signatory`, `observer`, `key`, `message`, ...) are contextual: they stay ordinary variables in
expressions such as `signatory this`.

## Scanner changes (all marked `DAML:` in `src/scanner.c`)

- `:` is reserved (the type annotation); `::` is a constructor operator.
- `catch` continues a `try` like `then`/`else` continue an `if` (no layout semicolon, closes inner layouts).
- `with` blocks get their own layout context (`_cmd_layout_start_with`). GHC closes implicit layouts on a parse error;
  the scanner approximates that:
  - the block only opens if the next token can start a field (otherwise `with` is empty, e.g. `with -- no params`);
  - inside brackets, `=` and `,` continue the block when the grammar accepts a field separator there
    (`_phantom_with_sep`) and the next token looks like a field, so `(T with a = 1, b = 2)` is one record while
    `(x, T with .., y)` is a 3-tuple;
  - `=`, `->` and `:` end a complete block that can't take them (`f T with .. = e`, `case x of T with a -> e`,
    `key T with a; id : T`).
- `_cond_choice_do`: a zero-width marker before the `do` that starts a choice body, so the last `controller` party
  isn't extended into `party do ...` by BlockArguments.

## Development

```sh
npm install
npx tree-sitter generate
npx tree-sitter test                  # test/corpus/daml.txt
npx tree-sitter build --wasm -o tree-sitter-daml.wasm .
scripts/corpus-stats.sh <dir>...      # parse every .daml file; failures in $OUT_DIR/<dir>.failures
scripts/first-errors.sh <failures>    # innermost error line per failing file
```

## Real-code coverage (2026-10-07)

Files that parse with no `ERROR`/`MISSING` node:

| Corpus | Files | Clean |
|---|---|---|
| [digital-asset/daml-finance](https://github.com/digital-asset/daml-finance) | 634 | 632 (99.7%) |
| [hyperledger-labs/splice](https://github.com/hyperledger-labs/splice) | 189 | 189 (100%) |
| [digital-asset/daml](https://github.com/digital-asset/daml) `sdk/` (compiler tests, docs, daml-script tests) | 747 | 742 (99.3%) |

Known failures:

- A `do` statement starting with a parenthesised negative literal followed by an operator (`(-0.052) === x`) — an
  upstream tree-sitter-haskell 0.23.1 bug (the same input fails as Haskell): its `[_pat_negation, literal]`
  precedence commits `(-1)` to a pattern at statement start. Hits daml-finance's `Fpml.daml` and the compiler's
  `PreludeTest.daml`.
- Compiler test files that are deliberately odd: invalid UTF-8 (`BadUTF8.daml`), tab-indentation warnings
  (`Warnings.daml`, `ide/warning_tab.daml`), and a chained pun `B a with x a with x` (`RecordsMore.daml`).

## License

MIT, as tree-sitter-haskell. See `LICENSE`.
