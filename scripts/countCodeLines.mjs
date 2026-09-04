import ts from 'typescript'
import fs from 'node:fs'

// Counts lines of real TS/TSX code, ignoring blanks and comment-only lines.
//
// Comments are found with the TypeScript PARSER, not a regex and not a bare
// scanner. `ts.createScanner` looks like the obvious tool and is wrong here: it
// has no parser context, so it reads a `/` as the start of a regex literal and
// swallows whole regions. Measured on spawn.ts it reported 105 single-line
// comments where the file has 401 — worse than the regex it would replace.
//
// Comments are excluded on purpose. kill.ts is 43% comment and spawn.ts 38%,
// and that documentation is what keeps their race conditions maintainable.
// Charging budget for it would push exactly the wrong way: a comment should
// always be free to add, logic should not. See #918.

/**
 * Every distinct comment range in a source file, as parsed.
 *
 * Ranges are collected per node rather than by scanning, and deduplicated
 * because a node's trailing comment is the next node's leading comment.
 */
function collectCommentRanges(text, sourceFile) {
  const ranges = []
  const seen = new Set()

  const add = (found) => {
    if (!found) return
    for (const range of found) {
      const key = `${range.pos}:${range.end}`
      if (seen.has(key)) continue
      seen.add(key)
      ranges.push(range)
    }
  }

  const visit = (node) => {
    add(ts.getLeadingCommentRanges(text, node.getFullStart()))
    add(ts.getTrailingCommentRanges(text, node.getEnd()))

    // `{/* why */}` parses as a JsxExpression with no expression inside. Its
    // braces are real tokens, so without this the line reads as code and a JSX
    // comment costs budget — the exact incentive this counter exists to avoid.
    // Claim the whole node, braces included.
    if (ts.isJsxExpression(node) && node.expression === undefined) {
      add([
        { pos: node.getStart(), end: node.getEnd(), kind: ts.SyntaxKind.MultiLineCommentTrivia }
      ])
    }

    // getChildren, not forEachChild. forEachChild skips punctuation tokens, so
    // a comment sitting on its own line before a closing `}` or `]` leads no
    // node and trails nothing on its line, falls through, and gets counted as
    // code. That is the common shape of a why-comment at the end of a body, so
    // it would have charged budget for exactly the comments this repo asks for.
    // Walking tokens too fixes every container at once rather than the three
    // that happened to get reported.
    for (const child of node.getChildren(sourceFile)) visit(child)
  }

  visit(sourceFile)

  return ranges
}

/** Whether the line still holds non-whitespace once every comment on it is blanked out. */
function hasCodeOutsideComments(lineText, lineStart, ranges) {
  const lineEnd = lineStart + lineText.length

  // split(''), not [...lineText]. The spread iterates code points, so one astral
  // character fills a single slot while TypeScript reports its range in UTF-16
  // code units. The indexes then drift by one per astral character and the loop
  // blanks that many characters of real code past the comment's end, which is
  // enough to report `/*<emoji>*/x` as comment-only and let the line grow unbudgeted.
  const chars = lineText.split('')

  for (const range of ranges) {
    const from = Math.max(range.pos, lineStart)
    const to = Math.min(range.end, lineEnd)
    for (let pos = from; pos < to; pos++) {
      chars[pos - lineStart] = ' '
    }
  }

  return chars.join('').trim().length > 0
}

/**
 * Line counts for one TS/TSX file.
 *
 * A line with code and a trailing comment counts as code, which is why this
 * masks comment ranges out of the line rather than classifying whole lines.
 *
 * Throws on a file the parser cannot read. A wrong number that looks fine is
 * the one outcome a budget gate must never produce.
 */
export function countCodeLines(filePath, sourceText) {
  const text = sourceText ?? fs.readFileSync(filePath, 'utf8')

  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )

  // `parseDiagnostics` is internal, so treat its absence as a failure rather than
  // defaulting to an empty array. A TypeScript upgrade that renames it would turn
  // the throw below into a silent pass, and an unparseable file would then be
  // counted instead of rejected: a wrong number that looks fine, which is the one
  // outcome this counter must never produce.
  const syntactic = sourceFile.parseDiagnostics
  if (!Array.isArray(syntactic)) {
    throw new Error(
      `${filePath}: could not be parsed (TypeScript no longer exposes parseDiagnostics)`
    )
  }

  if (syntactic.length > 0) {
    const first = syntactic[0]
    const message = ts.flattenDiagnosticMessageText(first.messageText, ' ')
    throw new Error(`${filePath}: could not be parsed (${message})`)
  }

  const ranges = collectCommentRanges(text, sourceFile)

  // Split on every terminator ECMAScript recognises, not just the three common
  // ones, because the offsets below come from the parser's own line map. U+2028
  // and U+2029 end a line for TypeScript, so omitting them puts a whole file on
  // one line here while the parser sees many: hundreds of statements would count
  // as one, sailing past both the threshold and any budget. Then drop the empty
  // tail a trailing terminator produces so counts match `wc -l`.
  const lines = text.split(/\r\n|\r|\n|\u2028|\u2029/)
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  let code = 0
  let comment = 0
  let blank = 0

  for (let index = 0; index < lines.length; index++) {
    const lineText = lines[index]

    if (!lineText.trim()) {
      blank++
      continue
    }

    const lineStart = sourceFile.getPositionOfLineAndCharacter(index, 0)
    if (hasCodeOutsideComments(lineText, lineStart, ranges)) {
      code++
    } else {
      comment++
    }
  }

  return { total: lines.length, code, comment, blank }
}
