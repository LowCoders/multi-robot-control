import { useEffect, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type * as MonacoNS from 'monaco-editor'
import './GcodeMonacoEditor.css'

interface Props {
  value: string
  readOnly: boolean
  newLineSet: Set<number>
  /** 1-based line currently being executed by the firmware (may be 0 when idle). */
  currentLine: number
  /** 1-based "look-ahead" pointer: the next line to execute. May equal totalLines+1
      when the last line is being executed (in which case an end-of-program marker
      is rendered after the last line). */
  pointerLine: number
  revision: number
  /** When set, position the cursor on this 1-based line (and reveal it) once the
      editor has mounted / received the new value. The parent should clear it via
      onCursorConsumed to avoid re-applying on every render. */
  initialCursorLine?: number | null
  onCursorConsumed?: () => void
  onChange: (value: string) => void
  /** Called when the user clicks the editor area while it is read-only — used to
      auto-switch to edit mode from the parent. */
  onReadOnlyClick?: (line: number) => void
}

const GCODE_LANGUAGE_ID = 'gcode'
const GCODE_THEME_ID = 'gcode-dark'

const KNOWN_G_CODES = new Set<number>([
  0, 1, 2, 3, 4, 17, 18, 19, 20, 21, 28, 30, 38, 40, 41, 42, 43, 49, 53, 54, 55, 56, 57, 58, 59,
  61, 64, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99,
])

const KNOWN_M_CODES = new Set<number>([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 19, 30, 60, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110,
  111, 112, 114, 115, 117, 118, 119, 220, 221,
])

let languageInitialized = false

function initGcodeLanguage(monaco: typeof MonacoNS): void {
  if (languageInitialized) return
  languageInitialized = true

  monaco.languages.register({ id: GCODE_LANGUAGE_ID })

  monaco.languages.setMonarchTokensProvider(GCODE_LANGUAGE_ID, {
    defaultToken: '',
    ignoreCase: true,
    tokenizer: {
      root: [
        [/;.*/, 'comment'],
        [/\([^)]*\)/, 'comment'],
        [/^\s*N\d+/, 'tag'],
        [/[GM]\d+(\.\d+)?/, 'keyword'],
        [/T\d+/, 'type'],
        [/[FS][-+]?\d*\.?\d+/, 'number.feed'],
        [/[XYZABCUVW][-+]?\d*\.?\d+/, 'number.axis'],
        [/[IJKR][-+]?\d*\.?\d+/, 'number.arc'],
        [/[PQH][-+]?\d*\.?\d+/, 'number'],
        [/\s+/, 'white'],
      ],
    },
  })

  monaco.languages.setLanguageConfiguration(GCODE_LANGUAGE_ID, {
    comments: { lineComment: ';' },
    brackets: [['(', ')']],
    autoClosingPairs: [{ open: '(', close: ')' }],
    surroundingPairs: [{ open: '(', close: ')' }],
  })

  monaco.editor.defineTheme(GCODE_THEME_ID, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '22c55e', fontStyle: 'italic' },
      { token: 'keyword', foreground: '60a5fa' },
      { token: 'type', foreground: 'fb923c' },
      { token: 'tag', foreground: '94a3b8' },
      { token: 'number.feed', foreground: 'eab308' },
      { token: 'number.axis', foreground: '22d3ee' },
      { token: 'number.arc', foreground: 'a78bfa' },
      { token: 'number', foreground: 'cbd5e1' },
    ],
    colors: {
      'editor.background': '#020617',
      'editor.foreground': '#cbd5e1',
      'editor.lineHighlightBackground': '#0f172a',
      'editorLineNumber.foreground': '#475569',
      'editorLineNumber.activeForeground': '#94a3b8',
      'editorGutter.background': '#020617',
    },
  })
}

interface LintIssue {
  line: number
  startCol: number
  endCol: number
  message: string
  severity: 'error' | 'warning'
}

function lintGcodeLine(line: string, lineNumber: number): LintIssue[] {
  const issues: LintIssue[] = []

  // Strip comments first
  let code = line
  const semi = code.indexOf(';')
  if (semi >= 0) code = code.slice(0, semi)
  code = code.replace(/\([^)]*\)/g, (m) => ' '.repeat(m.length))

  if (!code.trim()) return issues

  const wordRe = /([A-Za-z])([-+]?\d*\.?\d*)/g
  let match: RegExpExecArray | null
  let hasG2or3 = false
  let hasArcArg = false

  while ((match = wordRe.exec(code)) !== null) {
    const [whole, letter, value] = match
    const startCol = match.index + 1
    const endCol = startCol + whole.length
    const upper = letter.toUpperCase()

    if (value === '' || value === '-' || value === '+' || value === '.') {
      issues.push({
        line: lineNumber,
        startCol,
        endCol,
        message: `Hiányzó számérték a ${upper} szó után`,
        severity: 'warning',
      })
      continue
    }

    const num = Number(value)
    if (!Number.isFinite(num)) {
      issues.push({
        line: lineNumber,
        startCol,
        endCol,
        message: `Érvénytelen szám: ${value}`,
        severity: 'warning',
      })
      continue
    }

    if (upper === 'G') {
      const intPart = Math.trunc(num)
      if (!KNOWN_G_CODES.has(intPart)) {
        issues.push({
          line: lineNumber,
          startCol,
          endCol,
          message: `Ismeretlen G kód: G${num}`,
          severity: 'warning',
        })
      }
      if (intPart === 2 || intPart === 3) hasG2or3 = true
    } else if (upper === 'M') {
      const intPart = Math.trunc(num)
      if (!KNOWN_M_CODES.has(intPart)) {
        issues.push({
          line: lineNumber,
          startCol,
          endCol,
          message: `Ismeretlen M kód: M${num}`,
          severity: 'warning',
        })
      }
    } else if (['I', 'J', 'K', 'R'].includes(upper)) {
      hasArcArg = true
    }
  }

  if (hasG2or3 && !hasArcArg) {
    issues.push({
      line: lineNumber,
      startCol: 1,
      endCol: code.length + 1,
      message: 'G2/G3 esetén szükséges I/J vagy R argumentum',
      severity: 'warning',
    })
  }

  return issues
}

function runLint(monaco: typeof MonacoNS, model: MonacoNS.editor.ITextModel): void {
  const text = model.getValue()
  const lines = text.split('\n')
  const markers: MonacoNS.editor.IMarkerData[] = []
  for (let i = 0; i < lines.length; i++) {
    const issues = lintGcodeLine(lines[i], i + 1)
    for (const issue of issues) {
      markers.push({
        startLineNumber: issue.line,
        endLineNumber: issue.line,
        startColumn: issue.startCol,
        endColumn: issue.endCol,
        message: issue.message,
        severity:
          issue.severity === 'error'
            ? monaco.MarkerSeverity.Error
            : monaco.MarkerSeverity.Warning,
      })
    }
  }
  monaco.editor.setModelMarkers(model, 'gcode-linter', markers)
}

export default function GcodeMonacoEditor({
  value,
  readOnly,
  newLineSet,
  currentLine,
  pointerLine,
  revision,
  initialCursorLine,
  onCursorConsumed,
  onChange,
  onReadOnlyClick,
}: Props) {
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof MonacoNS | null>(null)
  const decorationsRef = useRef<string[]>([])
  const endZoneIdRef = useRef<string | null>(null)
  const lintTimerRef = useRef<number | null>(null)
  const lastValueRef = useRef<string>(value)
  const onReadOnlyClickRef = useRef(onReadOnlyClick)
  useEffect(() => {
    onReadOnlyClickRef.current = onReadOnlyClick
  }, [onReadOnlyClick])
  const readOnlyRef = useRef(readOnly)
  useEffect(() => {
    readOnlyRef.current = readOnly
  }, [readOnly])

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    initGcodeLanguage(monaco)
    const model = editor.getModel()
    if (model) {
      monaco.editor.setModelLanguage(model, GCODE_LANGUAGE_ID)
      runLint(monaco, model)
    }
    monaco.editor.setTheme(GCODE_THEME_ID)

    // Capture clicks while the editor is in read-only mode so the parent can
    // flip the buffer into edit mode (and we hand off the clicked line).
    editor.onMouseDown((e) => {
      if (!readOnlyRef.current) return
      const cb = onReadOnlyClickRef.current
      if (!cb) return
      const lineNumber = e.target?.position?.lineNumber ?? 1
      cb(lineNumber)
    })

    updateDecorations()
  }

  const updateDecorations = () => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco) return
    const model = editor.getModel()
    if (!model) return

    const decorations: MonacoNS.editor.IModelDeltaDecoration[] = []
    const totalLines = model.getLineCount()

    for (const idx of newLineSet) {
      const lineNumber = idx + 1
      if (lineNumber < 1 || lineNumber > totalLines) continue
      decorations.push({
        range: new monaco.Range(lineNumber, 1, lineNumber, 1),
        options: {
          isWholeLine: true,
          className: 'gcode-line-new',
          linesDecorationsClassName: 'gcode-glyph-new',
          overviewRuler: {
            color: 'rgba(34, 197, 94, 0.6)',
            position: monaco.editor.OverviewRulerLane.Left,
          },
        },
      })
    }

    // During run-mode highlight the line currently being executed as a subtle
    // hint, and the *next* line as the prominent look-ahead pointer.
    if (readOnly && currentLine > 0 && currentLine <= totalLines) {
      decorations.push({
        range: new monaco.Range(currentLine, 1, currentLine, 1),
        options: {
          isWholeLine: true,
          className: 'gcode-line-current',
          linesDecorationsClassName: 'gcode-glyph-current',
          overviewRuler: {
            color: 'rgba(234, 179, 8, 0.5)',
            position: monaco.editor.OverviewRulerLane.Center,
          },
        },
      })
    }

    if (readOnly && pointerLine > 0 && pointerLine <= totalLines) {
      decorations.push({
        range: new monaco.Range(pointerLine, 1, pointerLine, 1),
        options: {
          isWholeLine: true,
          className: 'gcode-line-next',
          linesDecorationsClassName: 'gcode-glyph-next',
          overviewRuler: {
            color: 'rgba(234, 179, 8, 0.95)',
            position: monaco.editor.OverviewRulerLane.Full,
          },
        },
      })
    }

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations)

    // End-of-program pointer: when the look-ahead overflows the buffer, draw a
    // view zone right after the last line so the cursor visually "stops below"
    // the program.
    const wantEndZone = readOnly && pointerLine > totalLines && currentLine > 0 && totalLines > 0
    editor.changeViewZones((accessor) => {
      if (endZoneIdRef.current) {
        accessor.removeZone(endZoneIdRef.current)
        endZoneIdRef.current = null
      }
      if (!wantEndZone) return
      const domNode = document.createElement('div')
      domNode.className = 'gcode-end-pointer-zone'
      domNode.textContent = '▶ — program vége —'
      endZoneIdRef.current = accessor.addZone({
        afterLineNumber: totalLines,
        heightInLines: 1,
        domNode,
      })
    })
  }

  // Sync external value -> model whenever it differs from the editor's
  // current contents. This covers both file loads (revision bumps) and
  // MDI-driven appends, regardless of whether @monaco-editor/react's own
  // value-prop sync fired in this render or not.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const model = editor.getModel()
    if (!model) return
    if (model.getValue() !== value) {
      // Preserve undo stack with executeEdits when possible; setValue resets it.
      model.setValue(value)
      lastValueRef.current = value
    }
  }, [value, revision])

  // Update decorations when relevant inputs change
  useEffect(() => {
    updateDecorations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newLineSet, currentLine, pointerLine, readOnly, revision, value])

  // Reveal the look-ahead line during running so the user can always see
  // where the machine is heading.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (!readOnly || pointerLine <= 0) return
    const model = editor.getModel()
    if (!model) return
    const totalLines = model.getLineCount()
    const target = Math.min(pointerLine, totalLines)
    editor.revealLineInCenter(target, 0 /* Smooth */)
  }, [pointerLine, readOnly])

  // Apply pending cursor placement requests from the parent (e.g. user clicked
  // a line in the read-only DOM view, which then flips us into edit mode).
  useEffect(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco) return
    if (initialCursorLine == null) return
    if (readOnly) return
    const model = editor.getModel()
    if (!model) return
    const totalLines = model.getLineCount()
    const line = Math.min(Math.max(initialCursorLine, 1), totalLines)
    editor.setPosition({ lineNumber: line, column: model.getLineMaxColumn(line) })
    editor.revealLineInCenter(line, 0)
    editor.focus()
    onCursorConsumed?.()
  }, [initialCursorLine, readOnly, value, onCursorConsumed])

  const handleChange = (val: string | undefined) => {
    const next = val ?? ''
    lastValueRef.current = next
    onChange(next)

    if (lintTimerRef.current !== null) {
      window.clearTimeout(lintTimerRef.current)
    }
    lintTimerRef.current = window.setTimeout(() => {
      const editor = editorRef.current
      const monaco = monacoRef.current
      if (!editor || !monaco) return
      const model = editor.getModel()
      if (model) runLint(monaco, model)
    }, 250)
  }

  useEffect(() => {
    return () => {
      if (lintTimerRef.current !== null) {
        window.clearTimeout(lintTimerRef.current)
      }
    }
  }, [])

  return (
    <Editor
      height="100%"
      defaultLanguage={GCODE_LANGUAGE_ID}
      language={GCODE_LANGUAGE_ID}
      theme={GCODE_THEME_ID}
      value={value}
      onMount={handleMount}
      onChange={handleChange}
      options={{
        readOnly,
        fontSize: 12,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        lineNumbers: 'on',
        glyphMargin: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        renderLineHighlight: readOnly ? 'none' : 'line',
        wordWrap: 'off',
      }}
      loading={
        <div className="flex items-center justify-center h-full text-steel-400 text-sm">
          Editor betöltése...
        </div>
      }
    />
  )
}
