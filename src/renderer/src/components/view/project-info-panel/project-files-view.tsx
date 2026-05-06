import type { ProjectDirectoryEntry } from '@shared/bridge.js';
import { Search } from 'lucide-react';
import { IgnoreRulesEditor } from '@/components/basic/ignore-rules-editor';
import { useState, useMemo } from 'react';
import { FileTreeView } from '@/components/basic/file-tree';

export function filterTree(nodes: ProjectDirectoryEntry[], query: string): ProjectDirectoryEntry[] {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return nodes;
    return nodes.flatMap(node => {
        const selfMatched = node.path.toLowerCase().includes(keyword) || node.name.toLowerCase().includes(keyword);
        const filteredChildren = node.children ? filterTree(node.children, query) : undefined;
        if (selfMatched) {
            return [{ ...node, ...(filteredChildren ? { children: filteredChildren } : {}) }];
        }
        if (filteredChildren && filteredChildren.length > 0) {
            return [{ ...node, children: filteredChildren }];
        }
        return [];
    });
}

export function ProjectFilesView({
    tree,
    ignoreText,
    onIgnoreTextChange,
}: {
    tree: ProjectDirectoryEntry[];
    ignoreText: string;
    onIgnoreTextChange: (value: string) => void;
}) {
    const [query, setQuery] = useState('');
    const visibleTree = useMemo(() => filterTree(tree, query), [tree, query]);

    return (
        <div className="flex h-full min-h-0 flex-col px-5 py-5">
            <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="搜索文件或目录"
                    className="h-9 w-full rounded-lg border border-border bg-background pr-3 pl-9 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
            </div>

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-background px-2 py-2">
                {visibleTree.length > 0 ? (
                    <FileTreeView tree={visibleTree} expandAll={query.trim().length > 0} />
                ) : (
                    <div className="px-2 py-6 text-note text-muted-foreground">没有匹配的文件。</div>
                )}
            </div>

            <div className="mt-4 space-y-2">
                <div>
                    <p className="text-subheading text-foreground">忽略规则</p>
                    <p className="mt-1 text-note text-muted-foreground">忽略同步的文件列表，格式与 .gitignore 相同。</p>
                </div>
                <IgnoreRulesEditor
                    value={ignoreText}
                    onChange={onIgnoreTextChange}
                    rows={3}
                />
            </div>
        </div>
    );
}
