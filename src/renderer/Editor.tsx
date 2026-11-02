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

function languageFor(file: string): string {
  const extension = file.split('.').pop()?.toLowerCase();
  return ({ ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', json: 'json', css: 'css', scss: 'scss', html: 'html', htm: 'html', cs: 'csharp', py: 'python', md: 'markdown', yaml: 'yaml', yml: 'yaml', xml: 'xml', sh: 'shell', ps1: 'powershell', sql: 'sql', rs: 'rust', go: 'go' } as Record<string, string>)[extension || ''] || 'plaintext';
}

export default function Editor({ tabs, activePath, onChange }: { tabs: EditorTab[]; activePath: string | null; onChange: (path: string, content: string) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const models = useRef(new Map<string, monaco.editor.ITextModel>());
  const subscriptions = useRef(new Map<string, monaco.IDisposable>());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!element.current) return;
    monaco.editor.defineTheme('code-agent-black', {
      base: 'vs-dark', inherit: true,
      rules: [
        { token: 'comment', foreground: '5f6070', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'f5a742' },
        { token: 'string', foreground: '7fe3b5' },
        { token: 'number', foreground: 'f59a9a' },
        { token: 'type', foreground: '7aa7ff' }
      ],
      colors: {
        'editor.background': '#09090b',
        'editorGutter.background': '#09090b',
        'editor.lineHighlightBackground': '#111115',
        'editor.lineHighlightBorder': '#00000000',
        'editorLineNumber.foreground': '#4a4a55',
        'editorLineNumber.activeForeground': '#b4b4c0',
        'editorCursor.foreground': '#f5a742',
        'editor.selectionBackground': '#f5a74238',
        'editor.inactiveSelectionBackground': '#f5a74220',
        'editorIndentGuide.background1': '#1a1a20',
        'editorIndentGuide.activeBackground1': '#2d2d37',
        'editorWidget.background': '#141418',
        'editorWidget.border': '#2d2d37',
        'scrollbarSlider.background': '#25252d99',
        'scrollbarSlider.hoverBackground': '#2d2d37cc'
      }
    });
    editor.current = monaco.editor.create(element.current, {
      model: null, theme: 'code-agent-black', readOnly: false, automaticLayout: true,
      minimap: { enabled: false }, fontFamily: 'Cascadia Code, Consolas, monospace',
      fontSize: 13, lineHeight: 21, scrollBeyondLastLine: false, smoothScrolling: true,
      padding: { top: 16, bottom: 20 }, renderLineHighlight: 'line', overviewRulerBorder: false
    });
    return () => {
      editor.current?.dispose(); editor.current = null;
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

  return <div className="monaco-host" ref={element} style={{ display: activePath ? undefined : 'none' }} />;
}
