import { useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface IgnoreRulesEditorProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    rows?: number;
    className?: string;
}

export function IgnoreRulesEditor({
    value,
    onChange,
    placeholder = '# 忽略文件，例如：\nnode_modules\n*.log',
    rows = 4,
    className,
}: IgnoreRulesEditorProps) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const highlightRef = useRef<HTMLPreElement | null>(null);
    const lines = useMemo(() => value.split(/\r?\n/), [value]);

    useEffect(() => {
        const textarea = textareaRef.current;
        const highlight = highlightRef.current;
        if (!textarea || !highlight) return;
        highlight.scrollTop = textarea.scrollTop;
        highlight.scrollLeft = textarea.scrollLeft;
    }, [value]);

    return (
        <div className={cn('rounded-lg border border-border bg-background', className)}>
            <div className="relative min-h-8 overflow-hidden rounded-[inherit]">
                <pre
                    ref={highlightRef}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 overflow-auto px-3 py-2.5 font-mono text-[13px] leading-6 whitespace-pre-wrap wrap-break-word"
                >
                    {lines.length > 0
                        ? lines.map((line, index) => (
                            <div key={`${index}-${line}`}>{renderHighlightedLine(line)}</div>
                        ))
                        : <div className="text-transparent">.</div>}
                </pre>
                <textarea
                    ref={textareaRef}
                    value={value}
                    rows={rows}
                    spellCheck={false}
                    placeholder={placeholder}
                    onChange={event => onChange(event.target.value)}
                    onScroll={event => {
                        if (!highlightRef.current) return;
                        highlightRef.current.scrollTop = event.currentTarget.scrollTop;
                        highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
                    }}
                    className="relative z-10 block min-h-8 w-full resize-y bg-transparent px-3 py-2.5 font-mono text-[13px] leading-6 text-transparent caret-foreground outline-none placeholder:text-muted-foreground/55 focus-visible:ring-2 focus-visible:ring-ring/40"
                />
            </div>
        </div>
    );
}

function renderHighlightedLine(line: string) {
    if (!line) return <span className="text-transparent">.</span>;
    const trimmed = line.trimStart();
    if (trimmed.startsWith('#')) {
        return <span className="text-muted-foreground">{line}</span>;
    }

    const parts = line.split(/([!*?/\[\]])/g);
    return parts.map((part, index) => {
        if (!part) return null;
        let className = 'text-foreground';
        if (part === '!') className = 'text-rose-500';
        else if (part === '*' || part === '?') className = 'text-sky-500';
        else if (part === '/' || part === '[' || part === ']') className = 'text-muted-foreground';
        return (
            <span key={`${index}-${part}`} className={className}>
                {part}
            </span>
        );
    });
}
