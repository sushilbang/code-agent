import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import CssWorker from 'monaco-editor/language/css/css.worker.js?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker.js?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';

self.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  }
};

export interface EditorTab { path: string; content: string; savedContent: string; size: number; lines: number }
export interface CursorInfo { line: number; column: number; selected: number; insertSpaces: boolean; tabSize: number; eol: 'LF' | 'CRLF'; language: string }

const languageNames: Record<string, string> = { typescript: 'TypeScript', javascript: 'JavaScript', json: 'JSON', css: 'CSS', scss: 'SCSS', html: 'HTML', csharp: 'C#', python: 'Python', markdown: 'Markdown', yaml: 'YAML', xml: 'XML', shell: 'Shell Script', powershell: 'PowerShell', sql: 'SQL', rust: 'Rust', go: 'Go', plaintext: 'Plain Text' };

function languageFor(file: string): string {
  const extension = file.split('.').pop()?.toLowerCase();
  return ({ ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', json: 'json', css: 'css', scss: 'scss', html: 'html', htm: 'html', cs: 'csharp', py: 'python', md: 'markdown', yaml: 'yaml', yml: 'yaml', xml: 'xml', sh: 'shell', ps1: 'powershell', sql: 'sql', rs: 'rust', go: 'go' } as Record<string, string>)[extension || ''] || 'plaintext';
}

export default function Editor({ tabs, activePath, onChange, onCursor, focusToken }: { tabs: EditorTab[]; activePath: string | null; onChange: (path: string, content: string) => void; onCursor: (info: CursorInfo | null) => void; focusToken: number }) {
  const element = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const models = useRef(new Map<string, monaco.editor.ITextModel>());
  const subscriptions = useRef(new Map<string, monaco.IDisposable>());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCursorRef = useRef(onCursor);
  onCursorRef.current = onCursor;

  useEffect(() => {
    if (!element.current) return;
    // VS Code "Dark Modern" workbench colors on top of Monaco's built-in dark token colors.
    monaco.editor.defineTheme('vscode-dark-modern', {
      base: 'vs-dark', inherit: true, rules: [],
      colors: {
        'editor.background': '#1f1f1f', 'editor.foreground': '#cccccc',
        'editorGutter.background': '#1f1f1f',
        'editor.lineHighlightBackground': '#ffffff0a', 'editor.lineHighlightBorder': '#282828',
        'editorLineNumber.foreground': '#6e7681', 'editorLineNumber.activeForeground': '#cccccc',
        'editorCursor.foreground': '#aeafad',
        'editor.selectionBackground': '#264f78', 'editor.inactiveSelectionBackground': '#3a3d41',
        'editorIndentGuide.background1': '#404040', 'editorIndentGuide.activeBackground1': '#707070',
        'editorWidget.background': '#202020', 'editorWidget.border': '#454545',
        'editorSuggestWidget.background': '#202020', 'editorSuggestWidget.border': '#454545',
        'input.background': '#313131', 'input.border': '#3c3c3c',
        focusBorder: '#0078d4',
        'minimap.background': '#1f1f1f',
        'scrollbarSlider.background': '#79797966', 'scrollbarSlider.hoverBackground': '#646464b3', 'scrollbarSlider.activeBackground': '#bfbfbf66'
      }
    });
    // The standalone TypeScript service cannot resolve project modules, so only syntax errors are reported.
    for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
    const created = monaco.editor.create(element.current, {
      model: null, theme: 'vscode-dark-modern', readOnly: false, automaticLayout: true,
      fontFamily: 'Consolas, "Courier New", monospace', fontSize: 14, lineHeight: 19,
      minimap: { enabled: true }, scrollBeyondLastLine: true, smoothScrolling: false,
      renderLineHighlight: 'line', bracketPairColorization: { enabled: true }, guides: { bracketPairs: false, indentation: true },
      cursorBlinking: 'blink', fixedOverflowWidgets: true
    });
    editor.current = created;
    const report = () => {
      const model = created.getModel();
      const position = created.getPosition();
      if (!model || !position) { onCursorRef.current(null); return; }
      const options = model.getOptions();
      onCursorRef.current({
        line: position.lineNumber, column: position.column,
        selected: (created.getSelections() || []).reduce((total, range) => total + model.getValueInRange(range).length, 0),
        insertSpaces: options.insertSpaces, tabSize: options.tabSize,
        eol: model.getEOL() === '\r\n' ? 'CRLF' : 'LF', language: languageNames[model.getLanguageId()] || model.getLanguageId()
      });
    };
    const reporters = [created.onDidChangeCursorPosition(report), created.onDidChangeCursorSelection(report), created.onDidChangeModel(report), created.onDidChangeModelContent(report)];
    return () => {
      reporters.forEach(reporter => reporter.dispose());
      created.dispose(); editor.current = null;
      subscriptions.current.forEach(subscription => subscription.dispose());
      models.current.forEach(model => model.dispose());
      subscriptions.current.clear(); models.current.clear();
    };
  }, []);

  useEffect(() => {
    const current = editor.current;
    if (!current) return;
    const paths = new Set(tabs.map(tab => tab.path));
    for (const [file, model] of models.current) {
      if (!paths.has(file)) {
        if (current.getModel() === model) current.setModel(null);
        subscriptions.current.get(file)?.dispose(); subscriptions.current.delete(file);
        model.dispose(); models.current.delete(file);
      }
    }
    for (const tab of tabs) {
      const existing = models.current.get(tab.path);
      if (existing) {
        if (existing.getValue() !== tab.content) existing.setValue(tab.content);
        continue;
      }
      const model = monaco.editor.createModel(tab.content, languageFor(tab.path), monaco.Uri.parse(`file:///${encodeURI(tab.path)}`));
      models.current.set(tab.path, model);
      subscriptions.current.set(tab.path, model.onDidChangeContent(() => onChangeRef.current(tab.path, model.getValue())));
    }
    const next = activePath ? models.current.get(activePath) || null : null;
    if (current.getModel() !== next) current.setModel(next);
  }, [tabs, activePath]);

  // Quick Open hands focus back to the editor so typing continues in the file that was just opened.
  useEffect(() => { if (focusToken > 0 && editor.current?.getModel()) editor.current.focus(); }, [focusToken]);

  return <div className="monaco-host" ref={element} style={{ display: activePath ? undefined : 'none' }} />;
}
