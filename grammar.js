/**
 * DAML grammar for tree-sitter.
 *
 * DAML is a GHC fork, so this grammar extends tree-sitter-haskell 0.23.1 (vendored unchanged in `haskell-grammar.js`
 * and `grammar/`) with DAML's surface syntax. Node names for shared Haskell constructs are kept, so Haskell queries and
 * extractors keep working on DAML trees.
 *
 * DAML-specific differences:
 *
 * - `:` is the type annotation and `::` is list cons (swapped from Haskell; see `src/scanner.c`).
 * - `with` introduces a layout of record fields, in data declarations (`data T = T with a : Int`) and in record
 *   construction/update expressions (`create this with owner = newOwner`).
 * - Contract declarations: `template`, `interface`, `exception`, with their bodies (`signatory`, `observer`,
 *   `ensure`, `key`, `maintainer`, `choice`, `interface instance`, `viewtype`, `message`, ...).
 * - `try ... catch` expressions in `Update`/`Script`.
 *
 * Most DAML keywords (`signatory`, `observer`, `key`, `message`, ...) are also ordinary functions in expressions
 * (`signatory this`). Tree-sitter only lexes a keyword where the parser can accept it, so they stay variables
 * elsewhere.
 */

const haskell = require('./haskell-grammar.js')

const {
  sep,
  sep1,
  braces,
  layout,
  layout_sort,
  context,
  forall,
} = require('./grammar/util.js')

/**
 * Comma-separated items in a `with` block. `_phantom_with_sep` tells the scanner that a `,` or `=` can continue the
 * block here, so it keeps the block open at a comma (`(T with a = 1, b = 2)`) and ends it otherwise
 * (`(x, T with .., y)`, `f T with .. = e`).
 */
const with_items = ($, rule) => seq(rule, repeat(seq(optional($._phantom_with_sep), ',', rule)))

/**
 * A `with` block: a layout of fields, also separable by commas (`with a : Int, b : Text`), optionally ending in a
 * `..` wildcard when `wildcard` is given. It uses its own layout start so the scanner doesn't end it at `=` or `,`
 * inside brackets, and the scanner doesn't start it when the next token can't be a field (an empty `with`).
 */
const with_block = ($, rule, wildcard) => seq(
  'with',
  optional(layout_sort(
    $,
    $._cmd_layout_start_with,
    wildcard
      ? choice(seq(with_items($, rule), optional(seq(',', wildcard))), wildcard)
      : with_items($, rule),
  )),
)

/** DAML record braces accept `;` as well as `,` between fields: `Transfer{newOwner; amount}`. */
const record_sep = choice(',', ';')

/** `kw e1, e2, ...` — a template or choice clause listing expressions (usually parties). */
const clause = ($, kw, name) => seq(kw, sep1(',', field(name, $._exp)))

/**
 * `controller a, b` — a choice clause. The scanner marks the `do` that starts the choice body (`_cond_choice_do`),
 * so the last party doesn't absorb it as a BlockArguments argument.
 */
const choice_clause = ($, kw) => seq(kw, sep1(',', field('party', $._exp)))

module.exports = grammar(haskell, {
  name: 'daml',

  externals: ($, original) => original.concat([
    $._cmd_layout_start_with,
    $._phantom_with_sep,
    // Zero-width marker before the `do` of a choice body; see `process_token_safe` in `src/scanner.c`.
    $._cond_choice_do,
  ]),

  rules: {

    // ------------------------------------------------------------------------
    // lexemes
    // ------------------------------------------------------------------------

    _colon2: _ => ':',

    // ------------------------------------------------------------------------
    // records with `with`
    // ------------------------------------------------------------------------

    /** `with` followed by a layout of field declarations, as in `template T with a : Int`. */
    _daml_record_fields: $ => with_block($, field('field', $.field)),

    _field_wildcard: $ => alias('..', $.wildcard),

    // The phantom is never emitted, only checked for validity, so its shift/reduce choice is irrelevant.
    _field_update_named: $ => prec.right(seq(
      field('field', $._field_spec),
      optional(seq(optional($._phantom_with_sep), '=', field('expression', $._exp))),
    )),

    // The phantom is never emitted, only checked for validity, so its shift/reduce choice is irrelevant.
    _field_pattern_named: $ => prec.right(seq(
      field('field', $._field_names),
      optional(seq(optional($._phantom_with_sep), '=', field('pattern', $._pat_texp))),
    )),

    /** `T with a = 1; b` in a pattern: `(TaggedClaim with claim; tag)`, `Users with ..`. */
    _pat_record_with: $ => prec('record', seq(
      field('constructor', $.pattern),
      with_block(
        $,
        field('field', alias($._field_pattern_named, $.field_pattern)),
        field('field', alias($._field_wildcard, $.field_pattern)),
      ),
    )),

    pattern: ($, original) => choice(
      original,
      alias($._pat_record_with, $.record),
    ),

    _record_fields: $ => braces($, sep(record_sep, field('field', $.field)), optional(record_sep)),

    _exp_record: $ => prec('record', seq(
      field('expression', $.expression),
      braces($, sep(record_sep, field('field', $.field_update)), optional(record_sep)),
    )),

    _pat_record: $ => prec('record', seq(
      field('constructor', $.pattern),
      braces($, sep(record_sep, field('field', $.field_pattern)), optional(record_sep)),
    )),

    _datacon_record_with: $ => seq(
      field('name', $._constructor),
      field('fields', alias($._daml_record_fields, $.fields)),
    ),

    data_constructor: $ => seq(
      forall($),
      context($),
      field('constructor', choice(
        alias($._datacon_prefix, $.prefix),
        alias($._datacon_infix, $.infix),
        alias($._datacon_record, $.record),
        alias($._datacon_record_with, $.record),
        alias($._datacon_special, $.special),
      )),
    ),

    newtype_constructor: $ => seq(
      field('name', $._con),
      field('field', choice(
        alias($._newtype_con_field, $.field),
        alias($._record_fields, $.record),
        alias($._daml_record_fields, $.record),
      )),
    ),

    /** `e with a = 1; b` — record construction or update, binding like Haskell's `e { a = 1, b }`. */
    _exp_record_with: $ => prec('record', seq(
      field('expression', $.expression),
      with_block(
        $,
        field('field', alias($._field_update_named, $.field_update)),
        field('field', alias($._field_wildcard, $.field_update)),
      ),
    )),

    // ------------------------------------------------------------------------
    // try / catch
    // ------------------------------------------------------------------------

    _exp_try: $ => seq(
      'try',
      field('expression', $._exp),
      'catch',
      optional(field('alternatives', $.alternatives)),
    ),

    expression: ($, original) => choice(
      original,
      alias($._exp_record_with, $.record),
      alias($._exp_try, $.try),
    ),

    // ------------------------------------------------------------------------
    // template
    // ------------------------------------------------------------------------

    signatory: $ => clause($, 'signatory', 'party'),
    observer: $ => clause($, 'observer', 'party'),
    maintainer: $ => clause($, 'maintainer', 'party'),
    ensure: $ => seq('ensure', field('expression', $._exp)),
    agreement: $ => seq('agreement', field('expression', $._exp)),

    /** `key (issuer, id) : (Party, Text)` */
    contract_key: $ => seq(
      'key',
      field('expression', $.expression),
      $._type_annotation,
    ),

    choice_consumption: _ => choice('nonconsuming', 'preconsuming', 'postconsuming'),

    controller: $ => choice_clause($, 'controller'),
    choice_observer: $ => choice_clause($, 'observer'),
    authority: $ => choice_clause($, 'authority'),

    _choice_body: $ => seq($._cond_choice_do, alias($._exp_do, $.do)),

    _choice_clause: $ => choice(
      $.controller,
      alias($.choice_observer, $.observer),
      $.authority,
    ),

    /**
     * > nonconsuming choice Transfer : ContractId Asset
     * >   with newOwner : Party
     * >   controller owner
     * >   do ...
     */
    template_choice: $ => seq(
      optional(field('consumption', $.choice_consumption)),
      'choice',
      field('name', $._constructor),
      $._type_annotation,
      optional(field('fields', alias($._daml_record_fields, $.fields))),
      choice(
        repeat(field('clause', $._choice_clause)),
        // `where controller p` / `where { controller p }`
        seq($._where, layout($, field('clause', $._choice_clause))),
      ),
      field('body', $._choice_body),
    ),

    /**
     * Pre-2.0 syntax:
     *
     * > controller owner can
     * >   Transfer : ContractId Asset
     * >     with newOwner : Party
     * >     do ...
     */
    _legacy_choice: $ => seq(
      optional(field('consumption', $.choice_consumption)),
      field('name', $._constructor),
      $._type_annotation,
      optional(field('fields', alias($._daml_record_fields, $.fields))),
      field('body', $._choice_body),
    ),

    controller_can: $ => seq(
      'controller',
      sep1(',', field('party', $.expression)),
      'can',
      layout($, field('choice', alias($._legacy_choice, $.template_choice))),
    ),

    /** `interface instance Holding.I for Asset where view = ...; getAmount = amount` */
    interface_instance: $ => seq(
      'interface',
      'instance',
      field('interface', $._tyconids),
      'for',
      field('template', $._tyconids),
      optional(seq($._where, optional(field('body', $.local_binds)))),
    ),

    /** Pre-2.0 `implements I where ...` */
    implements: $ => seq(
      'implements',
      field('interface', $._tyconids),
      optional(seq($._where, optional(field('body', $.local_binds)))),
    ),

    _template_decl: $ => choice(
      $.signatory,
      $.observer,
      $.maintainer,
      $.ensure,
      $.agreement,
      $.contract_key,
      $.let,
      $.template_choice,
      $.controller_can,
      $.interface_instance,
      $.implements,
    ),

    template_body: $ => layout($, field('declaration', $._template_decl)),

    template: $ => seq(
      'template',
      field('name', $._tyconid),
      optional(field('fields', alias($._daml_record_fields, $.fields))),
      optional(seq($._where, optional(field('body', $.template_body)))),
    ),

    // ------------------------------------------------------------------------
    // interface
    // ------------------------------------------------------------------------

    viewtype: $ => seq('viewtype', field('type', $.type)),

    _interface_decl: $ => choice(
      $.viewtype,
      $.signature,
      $.template_choice,
      $.interface_instance,
      $.ensure,
    ),

    interface_body: $ => layout($, field('declaration', $._interface_decl)),

    interface: $ => seq(
      'interface',
      field('name', $._tyconid),
      optional(seq('requires', sep1(',', field('requires', $._tyconids)))),
      optional(seq($._where, optional(field('body', $.interface_body)))),
    ),

    // ------------------------------------------------------------------------
    // exception
    // ------------------------------------------------------------------------

    message: $ => seq('message', field('expression', $._exp)),

    exception_body: $ => layout($, field('declaration', choice($.message, $.let))),

    exception: $ => seq(
      'exception',
      field('name', $._tyconid),
      optional(field('fields', alias($._daml_record_fields, $.fields))),
      optional(seq($._where, optional(field('body', $.exception_body)))),
    ),

    // ------------------------------------------------------------------------
    // top level
    // ------------------------------------------------------------------------

    declaration: ($, original) => choice(
      original,
      $.template,
      $.interface,
      $.exception,
    ),

  },
})
