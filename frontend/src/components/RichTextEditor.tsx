import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import clsx from 'clsx';

interface Props {
    value: string;
    onChange: (html: string) => void;
    placeholder?: string;
}

const ToolbarButton = ({
    onClick,
    active,
    title,
    children,
}: {
    onClick: () => void;
    active?: boolean;
    title: string;
    children: React.ReactNode;
}) => (
    <button
        type="button"
        title={title}
        onMouseDown={(e) => { e.preventDefault(); onClick(); }}
        className={clsx(
            'px-2 py-1 rounded text-sm font-medium transition-colors',
            active
                ? 'bg-primary text-white'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
        )}
    >
        {children}
    </button>
);

export default function RichTextEditor({ value, onChange, placeholder }: Props) {
    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3] },
                codeBlock: { languageClassPrefix: 'language-' },
                // Exclude extensions we add separately to avoid duplicate warnings
                dropcursor: false,
            }),
            Underline,
            Highlight,
            TextAlign.configure({ types: ['heading', 'paragraph'] }),
            Link.configure({ openOnClick: false, autolink: true }),
            Placeholder.configure({ placeholder: placeholder || 'Start writing your content...' }),
        ],
        content: value,
        onUpdate: ({ editor }) => {
            onChange(editor.getHTML());
        },
    });

    if (!editor) return null;

    const setLink = () => {
        const url = window.prompt('Enter URL:', editor.getAttributes('link').href || 'https://');
        if (url === null) return;
        if (url === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
        } else {
            editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
        }
    };

    return (
        <div className="border border-border rounded-xl overflow-hidden bg-background">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-0.5 p-2 border-b border-border bg-secondary/30">
                {/* Text style */}
                <div className="flex items-center gap-0.5 pr-2 border-r border-border mr-1">
                    <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
                        <strong>B</strong>
                    </ToolbarButton>
                    <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
                        <em>I</em>
                    </ToolbarButton>
                    <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline">
                        <span className="underline">U</span>
                    </ToolbarButton>
                    <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
                        <span className="line-through">S</span>
                    </ToolbarButton>
                    <ToolbarButton onClick={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive('highlight')} title="Highlight">
                        <span className="bg-yellow-300 text-black px-0.5 rounded text-xs">H</span>
                    </ToolbarButton>
                </div>

                {/* Headings */}
                <div className="flex items-center gap-0.5 pr-2 border-r border-border mr-1">
                    {([1, 2, 3] as const).map(level => (
                        <ToolbarButton
                            key={level}
                            onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
                            active={editor.isActive('heading', { level })}
                            title={`Heading ${level}`}
                        >
                            <span className="text-xs font-bold">H{level}</span>
                        </ToolbarButton>
                    ))}
                </div>

                {/* Lists */}
                <div className="flex items-center gap-0.5 pr-2 border-r border-border mr-1">
                    <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">
                        ≡
                    </ToolbarButton>
                    <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
                        <span className="text-xs">1.</span>
                    </ToolbarButton>
                </div>

                {/* Alignment */}
                <div className="flex items-center gap-0.5 pr-2 border-r border-border mr-1">
                    <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align left">
                        ←
                    </ToolbarButton>
                    <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Center">
                        ↔
                    </ToolbarButton>
                    <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align right">
                        →
                    </ToolbarButton>
                </div>

                {/* Code & quote */}
                <div className="flex items-center gap-0.5 pr-2 border-r border-border mr-1">
                    <ToolbarButton onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="Inline code">
                        <span className="font-mono text-xs">`c`</span>
                    </ToolbarButton>
                    <ToolbarButton onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} title="Code block">
                        <span className="font-mono text-xs">{'</>'}</span>
                    </ToolbarButton>
                    <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Blockquote">
                        "
                    </ToolbarButton>
                </div>

                {/* Link & misc */}
                <div className="flex items-center gap-0.5">
                    <ToolbarButton onClick={setLink} active={editor.isActive('link')} title="Insert link">
                        🔗
                    </ToolbarButton>
                    <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal rule">
                        —
                    </ToolbarButton>
                    <ToolbarButton onClick={() => editor.chain().focus().undo().run()} title="Undo">
                        ↩
                    </ToolbarButton>
                    <ToolbarButton onClick={() => editor.chain().focus().redo().run()} title="Redo">
                        ↪
                    </ToolbarButton>
                </div>
            </div>

            {/* Editor area */}
            <EditorContent
                editor={editor}
                className="min-h-[320px] max-h-[600px] overflow-y-auto p-4 prose prose-sm prose-invert max-w-none focus:outline-none
                    [&_.ProseMirror]:outline-none
                    [&_.ProseMirror]:min-h-[280px]
                    [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]
                    [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted-foreground
                    [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left
                    [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none
                    [&_.ProseMirror_h1]:text-2xl [&_.ProseMirror_h1]:font-black [&_.ProseMirror_h1]:mb-3
                    [&_.ProseMirror_h2]:text-xl [&_.ProseMirror_h2]:font-bold [&_.ProseMirror_h2]:mb-2
                    [&_.ProseMirror_h3]:text-lg [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_h3]:mb-2
                    [&_.ProseMirror_p]:mb-3
                    [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ul]:mb-3
                    [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6 [&_.ProseMirror_ol]:mb-3
                    [&_.ProseMirror_blockquote]:border-l-4 [&_.ProseMirror_blockquote]:border-primary [&_.ProseMirror_blockquote]:pl-4 [&_.ProseMirror_blockquote]:italic [&_.ProseMirror_blockquote]:text-muted-foreground
                    [&_.ProseMirror_code]:bg-secondary [&_.ProseMirror_code]:px-1 [&_.ProseMirror_code]:rounded [&_.ProseMirror_code]:font-mono [&_.ProseMirror_code]:text-sm
                    [&_.ProseMirror_pre]:bg-secondary [&_.ProseMirror_pre]:p-4 [&_.ProseMirror_pre]:rounded-lg [&_.ProseMirror_pre]:overflow-x-auto [&_.ProseMirror_pre]:mb-3
                    [&_.ProseMirror_hr]:border-border [&_.ProseMirror_hr]:my-4
                    [&_.ProseMirror_a]:text-primary [&_.ProseMirror_a]:underline
                    [&_.ProseMirror_mark]:bg-yellow-300 [&_.ProseMirror_mark]:text-black [&_.ProseMirror_mark]:rounded"
            />

            {/* Word count */}
            <div className="px-4 py-2 border-t border-border bg-secondary/20 flex justify-end">
                <span className="text-xs text-muted-foreground">
                    {editor.storage.characterCount?.words?.() ?? editor.getText().split(/\s+/).filter(Boolean).length} words
                </span>
            </div>
        </div>
    );
}
