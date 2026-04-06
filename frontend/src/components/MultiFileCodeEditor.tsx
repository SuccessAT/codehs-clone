import { useState, useRef } from 'react';
import MonacoEditor from '@monaco-editor/react';
import clsx from 'clsx';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface EditorFile {
    id: string;
    name: string;
    content: string;
    language: string;
}

export interface TestCase {
    id: string;
    description: string;
    input: string;
    expected_output: string;
}

export interface MultiFilePayload {
    __multifile: true;
    files: EditorFile[];
    test_cases: TestCase[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const EXT_LANGUAGE: Record<string, string> = {
    py: 'python',
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    java: 'java',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    c: 'c',
    cs: 'csharp',
    go: 'go',
    rs: 'rust',
    rb: 'ruby',
    php: 'php',
    html: 'html',
    css: 'css',
    json: 'json',
    md: 'markdown',
    sh: 'shell',
    sql: 'sql',
    r: 'r',
    swift: 'swift',
    kt: 'kotlin',
};

const SUPPORTED_LANGUAGES = [
    'python', 'javascript', 'typescript', 'java', 'cpp', 'c', 'csharp',
    'go', 'rust', 'ruby', 'php', 'html', 'css', 'json', 'markdown',
    'shell', 'sql', 'r', 'swift', 'kotlin',
];

const DEFAULT_STARTERS: Record<string, string> = {
    python: '# Write your solution here\n\ndef solution():\n    pass\n',
    javascript: '// Write your solution here\n\nfunction solution() {\n  \n}\n',
    typescript: '// Write your solution here\n\nfunction solution(): void {\n  \n}\n',
    java: 'public class Main {\n    public static void main(String[] args) {\n        \n    }\n}\n',
    cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n',
    c: '#include <stdio.h>\n\nint main() {\n    \n    return 0;\n}\n',
    html: '<!DOCTYPE html>\n<html>\n<head>\n  <title>Page</title>\n</head>\n<body>\n  \n</body>\n</html>\n',
    css: '/* Write your styles here */\n\nbody {\n  \n}\n',
};

function detectLanguage(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    return EXT_LANGUAGE[ext] ?? 'plaintext';
}

function uid(): string {
    return Math.random().toString(36).slice(2, 9);
}

export function serializePayload(files: EditorFile[], testCases: TestCase[]): string {
    const payload: MultiFilePayload = { __multifile: true, files, test_cases: testCases };
    return JSON.stringify(payload);
}

export function parsePayload(raw: string): { files: EditorFile[]; testCases: TestCase[] } {
    if (!raw) return { files: [{ id: uid(), name: 'main.py', content: DEFAULT_STARTERS.python, language: 'python' }], testCases: [] };
    try {
        const parsed = JSON.parse(raw);
        if (parsed.__multifile) {
            return { files: parsed.files ?? [], testCases: parsed.test_cases ?? [] };
        }
    } catch (_) { /* fall through to legacy */ }
    return {
        files: [{ id: uid(), name: 'main.py', content: raw, language: 'python' }],
        testCases: [],
    };
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
    value: string;
    primaryLanguage: string;
    onChange: (serialized: string, primaryLanguage: string) => void;
}

export default function MultiFileCodeEditor({ value, primaryLanguage, onChange }: Props) {
    const { files: initialFiles, testCases: initialCases } = parsePayload(value);
    const [files, setFiles] = useState<EditorFile[]>(initialFiles);
    const [testCases, setTestCases] = useState<TestCase[]>(initialCases);
    const [activeFileId, setActiveFileId] = useState<string>(initialFiles[0]?.id ?? '');
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [showTestCases, setShowTestCases] = useState(true);
    const renameRef = useRef<HTMLInputElement>(null);

    const activeFile = files.find(f => f.id === activeFileId) ?? files[0];

    const emit = (nextFiles: EditorFile[], nextCases: TestCase[]) => {
        const primary = nextFiles[0]?.language ?? primaryLanguage;
        onChange(serializePayload(nextFiles, nextCases), primary);
    };

    // ── File ops ──────────────────────────────────────────────────────────────

    const addFile = () => {
        const lang = primaryLanguage || 'python';
        const ext = Object.entries(EXT_LANGUAGE).find(([, l]) => l === lang)?.[0] ?? 'py';
        const existingNames = new Set(files.map(f => f.name));
        let name = `file.${ext}`;
        let i = 2;
        while (existingNames.has(name)) { name = `file${i++}.${ext}`; }
        const newFile: EditorFile = {
            id: uid(),
            name,
            content: DEFAULT_STARTERS[lang] ?? '',
            language: lang,
        };
        const next = [...files, newFile];
        setFiles(next);
        setActiveFileId(newFile.id);
        emit(next, testCases);
    };

    const removeFile = (id: string) => {
        if (files.length === 1) return;
        const next = files.filter(f => f.id !== id);
        setFiles(next);
        if (activeFileId === id) setActiveFileId(next[0].id);
        emit(next, testCases);
    };

    const updateActiveContent = (content: string) => {
        const next = files.map(f => f.id === activeFile.id ? { ...f, content } : f);
        setFiles(next);
        emit(next, testCases);
    };

    const updateFileLanguage = (id: string, language: string) => {
        const next = files.map(f => f.id === id ? { ...f, language } : f);
        setFiles(next);
        emit(next, testCases);
    };

    const startRename = (file: EditorFile) => {
        setRenamingId(file.id);
        setRenameValue(file.name);
        setTimeout(() => renameRef.current?.select(), 50);
    };

    const commitRename = () => {
        if (!renamingId) return;
        const trimmed = renameValue.trim();
        if (!trimmed) { setRenamingId(null); return; }
        const detectedLang = detectLanguage(trimmed);
        const next = files.map(f =>
            f.id === renamingId
                ? { ...f, name: trimmed, language: detectedLang !== 'plaintext' ? detectedLang : f.language }
                : f
        );
        setFiles(next);
        setRenamingId(null);
        emit(next, testCases);
    };

    // ── Test case ops ─────────────────────────────────────────────────────────

    const addTestCase = () => {
        const tc: TestCase = { id: uid(), description: `Test ${testCases.length + 1}`, input: '', expected_output: '' };
        const next = [...testCases, tc];
        setTestCases(next);
        emit(files, next);
    };

    const updateTestCase = (id: string, field: keyof TestCase, val: string) => {
        const next = testCases.map(tc => tc.id === id ? { ...tc, [field]: val } : tc);
        setTestCases(next);
        emit(files, next);
    };

    const removeTestCase = (id: string) => {
        const next = testCases.filter(tc => tc.id !== id);
        setTestCases(next);
        emit(files, next);
    };

    return (
        <div className="border border-border rounded-xl overflow-hidden bg-[#1e1e1e] flex flex-col">
            {/* ── File Tabs ───────────────────────────────────────────────────── */}
            <div className="flex items-stretch bg-[#252526] border-b border-[#3c3c3c] overflow-x-auto">
                {files.map((file) => (
                    <div
                        key={file.id}
                        className={clsx(
                            'group flex items-center min-w-0 border-r border-[#3c3c3c] transition-colors',
                            file.id === activeFile?.id
                                ? 'bg-[#1e1e1e] text-white'
                                : 'bg-[#2d2d2d] text-[#969696] hover:text-white hover:bg-[#2a2a2a]'
                        )}
                    >
                        {renamingId === file.id ? (
                            <input
                                ref={renameRef}
                                className="px-3 py-2.5 text-xs bg-transparent text-white outline-none w-32 border-b border-primary"
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onBlur={commitRename}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') commitRename();
                                    if (e.key === 'Escape') setRenamingId(null);
                                }}
                            />
                        ) : (
                            <button
                                className="px-3 py-2.5 text-xs font-mono truncate max-w-[140px] flex items-center gap-1.5"
                                onClick={() => setActiveFileId(file.id)}
                                onDoubleClick={() => startRename(file)}
                            >
                                <span className="text-[10px] opacity-60">
                                    {getFileIcon(file.language)}
                                </span>
                                {file.name}
                            </button>
                        )}
                        {files.length > 1 && (
                            <button
                                onClick={() => removeFile(file.id)}
                                className="pr-2 opacity-0 group-hover:opacity-60 hover:!opacity-100 text-[#969696] hover:text-red-400 text-sm flex-shrink-0"
                                title="Close file"
                            >×</button>
                        )}
                    </div>
                ))}
                <button
                    onClick={addFile}
                    className="px-3 py-2.5 text-[#969696] hover:text-white text-sm flex-shrink-0 transition-colors"
                    title="New file"
                >+ New File</button>
            </div>

            {/* ── Language selector for active file ───────────────────────────── */}
            {activeFile && (
                <div className="flex items-center justify-between px-4 py-1.5 bg-[#252526] border-b border-[#3c3c3c] text-xs text-[#969696]">
                    <span className="font-mono">{activeFile.name}</span>
                    <div className="flex items-center gap-2">
                        <span>Language:</span>
                        <select
                            value={activeFile.language}
                            onChange={(e) => updateFileLanguage(activeFile.id, e.target.value)}
                            className="bg-[#3c3c3c] text-[#cccccc] text-xs rounded px-2 py-0.5 border-none outline-none"
                        >
                            {SUPPORTED_LANGUAGES.map(l => (
                                <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>
                            ))}
                        </select>
                        <span className="opacity-40">·</span>
                        <span className="opacity-60">Double-click tab to rename</span>
                    </div>
                </div>
            )}

            {/* ── Monaco Editor ────────────────────────────────────────────────── */}
            {activeFile && (
                <MonacoEditor
                    key={activeFile.id}
                    height="320px"
                    language={activeFile.language}
                    theme="vs-dark"
                    value={activeFile.content}
                    onChange={(val) => updateActiveContent(val || '')}
                    options={{
                        minimap: { enabled: false },
                        fontSize: 14,
                        lineNumbers: 'on',
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        padding: { top: 12, bottom: 12 },
                        tabSize: activeFile.language === 'python' ? 4 : 2,
                        wordWrap: 'on',
                        folding: true,
                        renderWhitespace: 'selection',
                    }}
                />
            )}

            {/* ── Test Cases ───────────────────────────────────────────────────── */}
            <div className="border-t border-[#3c3c3c]">
                <button
                    onClick={() => setShowTestCases(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-bold text-[#969696] hover:text-white hover:bg-[#2d2d2d] transition-colors"
                >
                    <div className="flex items-center gap-2">
                        <span className="text-sm">🧪</span>
                        <span className="uppercase tracking-widest">Test Cases</span>
                        {testCases.length > 0 && (
                            <span className="bg-primary/20 text-primary px-1.5 py-0.5 rounded text-[10px]">
                                {testCases.length}
                            </span>
                        )}
                    </div>
                    <span className="text-sm">{showTestCases ? '▾' : '▸'}</span>
                </button>

                {showTestCases && (
                    <div className="bg-[#1a1a1a] px-4 pb-4 space-y-3">
                        {testCases.length === 0 ? (
                            <p className="text-xs text-[#666] py-2">
                                No test cases yet. Add test cases to automatically validate student submissions.
                            </p>
                        ) : (
                            testCases.map((tc, idx) => (
                                <div key={tc.id} className="border border-[#3c3c3c] rounded-lg overflow-hidden">
                                    <div className="flex items-center justify-between px-3 py-1.5 bg-[#252526] border-b border-[#3c3c3c]">
                                        <input
                                            className="bg-transparent text-xs text-[#cccccc] outline-none flex-1 font-mono"
                                            value={tc.description}
                                            onChange={(e) => updateTestCase(tc.id, 'description', e.target.value)}
                                            placeholder={`Test case ${idx + 1} description...`}
                                        />
                                        <button
                                            onClick={() => removeTestCase(tc.id)}
                                            className="text-[#666] hover:text-red-400 text-sm ml-2 transition-colors"
                                        >×</button>
                                    </div>
                                    <div className="grid grid-cols-2 divide-x divide-[#3c3c3c]">
                                        <div>
                                            <div className="px-3 py-1 bg-[#1f1f1f] text-[9px] font-bold uppercase tracking-widest text-[#666] border-b border-[#3c3c3c]">
                                                stdin / Input
                                            </div>
                                            <textarea
                                                className="w-full bg-transparent text-[#cccccc] text-xs font-mono px-3 py-2 outline-none resize-none"
                                                rows={4}
                                                placeholder="Input passed to stdin..."
                                                value={tc.input}
                                                onChange={(e) => updateTestCase(tc.id, 'input', e.target.value)}
                                            />
                                        </div>
                                        <div>
                                            <div className="px-3 py-1 bg-[#1f1f1f] text-[9px] font-bold uppercase tracking-widest text-[#666] border-b border-[#3c3c3c]">
                                                Expected Output
                                            </div>
                                            <textarea
                                                className="w-full bg-transparent text-[#cccccc] text-xs font-mono px-3 py-2 outline-none resize-none"
                                                rows={4}
                                                placeholder="Expected stdout output..."
                                                value={tc.expected_output}
                                                onChange={(e) => updateTestCase(tc.id, 'expected_output', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}

                        <button
                            onClick={addTestCase}
                            className="w-full py-2 rounded-lg border border-dashed border-[#3c3c3c] text-xs text-[#666] hover:border-primary hover:text-primary transition-colors"
                        >
                            + Add Test Case
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

// ── File icon helper ───────────────────────────────────────────────────────────

function getFileIcon(language: string): string {
    const icons: Record<string, string> = {
        python: '🐍',
        javascript: '📜',
        typescript: '📘',
        java: '☕',
        cpp: '⚙️',
        c: '⚙️',
        csharp: '🔵',
        go: '🐹',
        rust: '🦀',
        ruby: '💎',
        php: '🐘',
        html: '🌐',
        css: '🎨',
        json: '📋',
        markdown: '📝',
        shell: '💲',
        sql: '🗄️',
        r: '📊',
        swift: '🍎',
        kotlin: '🎯',
    };
    return icons[language] ?? '📄';
}
