// ---------------------------------------------------------------------------
// 工具栏：搜索、视图切换、扫描、添加项目
// ---------------------------------------------------------------------------

import { useState, type KeyboardEvent } from 'react';
import { FolderPlus, LayoutGrid, List, RefreshCw, Search, X } from 'lucide-react';
import type {
    ManualProjectInput,
    ManualProjectValidationResult,
    ProjectDirectoryInspection,
    ProjectFingerprint,
} from '@shared/bridge.js';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppActions, useAppState } from '../store/app-store.js';

export function Toolbar() {
    const { search, view, scanProgress } = useAppState();
    const actions = useAppActions();
    const scanning = !!scanProgress?.running;
    const [addOpen, setAddOpen] = useState(false);

    return (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card/40 px-2.5">
            <div className="relative flex-1 max-w-md">
                <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                    type="text"
                    placeholder="搜索项目名、标签、路径"
                    value={search}
                    onChange={e => actions.setSearch(e.target.value)}
                    className="h-7 w-full rounded-md border border-border bg-background pr-2 pl-7 outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
            </div>

            <div className="flex h-7 items-center gap-0.5 rounded-md border border-border bg-background p-px">
                <ViewButton
                    active={view === 'grid'}
                    onClick={() => actions.setView('grid')}
                    icon={<LayoutGrid className="size-3.5" />}
                />
                <ViewButton
                    active={view === 'list'}
                    onClick={() => actions.setView('list')}
                    icon={<List className="size-3.5" />}
                />
            </div>

            <Button
                size="sm"
                variant="outline"
                disabled={scanning}
                onClick={() => void actions.runScanAll()}
            >
                <RefreshCw className={cn('size-3.5', scanning && 'animate-spin')} />
                {scanning ? '扫描中…' : '扫描'}
            </Button>

            <Button size="sm" variant="outline" className="ml-auto" onClick={() => setAddOpen(true)}>
                <FolderPlus className="size-3.5" /> 添加项目
            </Button>

            {addOpen ? <AddProjectDialog onClose={() => setAddOpen(false)} /> : null}
        </div>
    );
}

function ViewButton({
    icon,
    active,
    onClick,
}: {
    icon: React.ReactNode;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'flex size-6 items-center justify-center rounded-sm',
                active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
        >
            {icon}
        </button>
    );
}

// ---------------------------------------------------------------------------
// 添加项目对话框
// ---------------------------------------------------------------------------

function AddProjectDialog({ onClose }: { onClose: () => void }) {
    const actions = useAppActions();
    const [form, setForm] = useState<ManualProjectInput & { tagsDraft: string }>({
        path: '',
        name: '',
        description: '',
        tags: [],
        fingerprint: { kind: 'metadata' },
        tagsDraft: '',
    });
    const [busy, setBusy] = useState(false);
    const [inspection, setInspection] = useState<ProjectDirectoryInspection | null>(null);
    const [validation, setValidation] = useState<ManualProjectValidationResult>({ valid: false, conflicts: [] });

    const buildInput = (override?: Partial<ManualProjectInput>): ManualProjectInput => {
        const fallbackName = form.name?.trim() || undefined;
        const fallbackDescription = form.description?.trim() || undefined;
        return {
            path: override?.path ?? form.path.trim(),
            name: override?.name ?? fallbackName,
            description: override?.description ?? fallbackDescription,
            tags: override?.tags ?? form.tags,
            fingerprint: override?.fingerprint ?? form.fingerprint,
        };
    };

    const inspectDirectory = async (dir: string) => {
        const next = await window.fm.projects.inspectDirectory(dir);
        setInspection(next);
        setForm(prev => ({
            ...prev,
            path: next.path,
            name: prev.name || next.suggestedName,
            fingerprint: next.hasMetaFile ? { kind: 'metadata' } : prev.fingerprint,
        }));
        return next;
    };

    const validate = async (override?: Partial<ManualProjectInput>) => {
        const payload = buildInput(override);
        if (!payload.path) {
            setValidation({ valid: false, conflicts: [] });
            return;
        }
        const result = await window.fm.projects.validateNew(payload);
        setValidation(result);
    };

    const pickDir = async () => {
        const dir = await actions.pickProjectDirectory();
        if (!dir) return;
        const next = await inspectDirectory(dir);
        await validate({
            path: next.path,
            name: form.name?.trim() || next.suggestedName,
            fingerprint: next.hasMetaFile ? { kind: 'metadata' } : form.fingerprint,
        });
    };

    const addTag = (raw: string) => {
        const t = raw.trim().replace(/^#/, '');
        if (!t || form.tags?.includes(t)) return;
        setForm(prev => ({ ...prev, tags: [...(prev.tags ?? []), t] }));
    };

    const onTagKey = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addTag(form.tagsDraft);
            setForm(prev => ({ ...prev, tagsDraft: '' }));
        } else if (e.key === 'Backspace' && form.tagsDraft === '' && (form.tags?.length ?? 0) > 0) {
            setForm(prev => ({ ...prev, tags: prev.tags?.slice(0, -1) ?? [] }));
        }
    };

    const setFingerprint = (fingerprint: ProjectFingerprint) => {
        setForm(prev => ({ ...prev, fingerprint }));
        void validate({ fingerprint });
    };

    const updateFilePathFingerprint = (file: string, checked: boolean) => {
        const current = form.fingerprint.kind === 'file-paths' ? form.fingerprint.paths : [];
        const paths = checked ? [...current, file] : current.filter(item => item !== file);
        setFingerprint({ kind: 'file-paths', paths });
    };

    const submit = async () => {
        if (!form.path.trim() || busy || !validation.valid) return;
        setBusy(true);
        try {
            const project = await actions.addProject(buildInput());
            actions.toast('success', `已添加项目：${project.name}`);
            onClose();
        } catch (err) {
            actions.toast('error', err instanceof Error ? err.message : '添加失败');
        } finally {
            setBusy(false);
        }
    };

    const addDisabled =
        !form.path.trim() ||
        busy ||
        !validation.valid ||
        (form.fingerprint.kind === 'file-paths' && form.fingerprint.paths.length === 0);

    return (
        <>
            <button
                type="button"
                aria-label="关闭"
                onClick={onClose}
                className="fixed inset-0 z-40 cursor-default bg-black/30 backdrop-blur-[1px]"
            />
            <div
                role="dialog"
                aria-modal="true"
                className="fixed top-1/2 left-1/2 z-50 w-[640px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-border bg-card shadow-xl"
            >
                <div className="flex h-11 items-center justify-between border-b border-border px-3">
                    <h2 className="text-heading">添加项目</h2>
                    <Button size="icon-xs" variant="ghost" onClick={onClose}>
                        <X className="size-3.5" />
                    </Button>
                </div>
                <div className="max-h-[70vh] space-y-4 overflow-y-auto px-4 py-4">
                    <DialogField label="路径">
                        <div className="flex items-center gap-2">
                            <input
                                value={form.path}
                                onChange={e => setForm(prev => ({ ...prev, path: e.target.value }))}
                                onBlur={() => {
                                    const path = form.path.trim();
                                    if (!path) return;
                                    void inspectDirectory(path).then(() => void validate()).catch(() => undefined);
                                }}
                                placeholder="选择或粘贴项目目录"
                                className="h-9 flex-1 rounded-md border border-border bg-background px-2 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                            />
                            <Button size="sm" variant="outline" onClick={() => void pickDir()}>
                                浏览…
                            </Button>
                        </div>
                        {inspection ? (
                            <p className="mt-2 text-note text-muted-foreground">
                                {inspection.hasMetaFile
                                    ? `检测到 .meta-data${inspection.metaProjectId ? `（projectId: ${inspection.metaProjectId}）` : ''}`
                                    : `未检测到 .meta-data，共发现 ${inspection.files.length} 个文件可用于路径指纹。`}
                            </p>
                        ) : null}
                    </DialogField>

                    <DialogField label="名称">
                        <input
                            value={form.name}
                            onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                            className="h-9 w-full rounded-md border border-border bg-background px-2 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                        />
                    </DialogField>

                    <DialogField label="描述">
                        <textarea
                            rows={3}
                            value={form.description}
                            onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                            className="w-full resize-none rounded-md border border-border bg-background p-2 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                        />
                    </DialogField>

                    <DialogField label="标签">
                        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5">
                            {form.tags?.map(t => (
                                <span
                                    key={t}
                                    className="flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-caption text-secondary-foreground"
                                >
                                    #{t}
                                    <button
                                        type="button"
                                        className="text-muted-foreground hover:text-foreground"
                                        onClick={() => setForm(prev => ({ ...prev, tags: prev.tags?.filter(x => x !== t) ?? [] }))}
                                    >
                                        <X className="size-3" />
                                    </button>
                                </span>
                            ))}
                            <input
                                value={form.tagsDraft}
                                onChange={e => setForm(prev => ({ ...prev, tagsDraft: e.target.value }))}
                                onKeyDown={onTagKey}
                                placeholder={form.tags?.length === 0 ? '回车添加标签' : ''}
                                className="flex-1 min-w-[80px] bg-transparent outline-none placeholder:text-muted-foreground/70"
                            />
                        </div>
                    </DialogField>

                    <DialogField label="项目指纹">
                        {inspection?.hasMetaFile ? (
                            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-note text-muted-foreground">
                                当前目录已存在 `.meta-data`，将直接使用 metadata 指纹。
                            </div>
                        ) : (
                            <div className="space-y-3 rounded-md border border-border bg-background p-3">
                                <label className="flex items-start gap-2">
                                    <input
                                        type="radio"
                                        checked={form.fingerprint.kind === 'metadata'}
                                        onChange={() => setFingerprint({ kind: 'metadata' })}
                                    />
                                    <span>
                                        <span className="block text-subheading text-foreground">添加 metadata</span>
                                        <span className="text-note text-muted-foreground">保存时自动写入 `.meta-data` 与稳定 `projectId`。</span>
                                    </span>
                                </label>

                                <label className="flex items-start gap-2">
                                    <input
                                        type="radio"
                                        checked={form.fingerprint.kind === 'folder-name'}
                                        onChange={() =>
                                            setFingerprint({
                                                kind: 'folder-name',
                                                folderName: inspection?.suggestedName ?? form.path.split(/[/\\]/).filter(Boolean).pop() ?? '',
                                            })
                                        }
                                    />
                                    <span>
                                        <span className="block text-subheading text-foreground">使用文件夹名称</span>
                                        <span className="text-note text-muted-foreground">当前文件夹名：{inspection?.suggestedName || '未检测'}</span>
                                    </span>
                                </label>

                                <label className="flex items-start gap-2">
                                    <input
                                        type="radio"
                                        checked={form.fingerprint.kind === 'file-paths'}
                                        onChange={() =>
                                            setFingerprint({
                                                kind: 'file-paths',
                                                paths: form.fingerprint.kind === 'file-paths' ? form.fingerprint.paths : [],
                                            })
                                        }
                                    />
                                    <span>
                                        <span className="block text-subheading text-foreground">文件路径指纹</span>
                                        <span className="text-note text-muted-foreground">勾选一组相对路径，扫描时这些文件全部存在则判定为同一项目。</span>
                                    </span>
                                </label>

                                {form.fingerprint.kind === 'file-paths' ? (
                                    <div className="max-h-52 overflow-y-auto rounded-md border border-border bg-card/50 p-2">
                                        {inspection?.files.length ? (
                                            <div className="space-y-1">
                                                {inspection.files.map(file => {
                                                    const checked = form.fingerprint.kind === 'file-paths' && form.fingerprint.paths.includes(file);
                                                    const depth = Math.max(0, file.split('/').length - 1);
                                                    return (
                                                        <label
                                                            key={file}
                                                            className="flex items-center gap-2 rounded px-1 py-1 text-note hover:bg-muted"
                                                            style={{ paddingLeft: `${depth * 12 + 4}px` }}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={checked}
                                                                onChange={e => updateFilePathFingerprint(file, e.target.checked)}
                                                            />
                                                            <span className="break-all">{file}</span>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <p className="text-note text-muted-foreground">请先选择项目目录。</p>
                                        )}
                                    </div>
                                ) : null}
                            </div>
                        )}
                    </DialogField>

                    {!validation.valid && validation.conflicts.length > 0 ? (
                        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-note text-amber-700 dark:text-amber-300">
                            <p className="font-medium">当前指纹与现有项目冲突，无法添加：</p>
                            <ul className="mt-2 list-disc space-y-1 pl-5">
                                {validation.conflicts.map(conflict => (
                                    <li key={`${conflict.projectId}-${conflict.reason}`}>
                                        {conflict.projectName}：{conflict.reason}
                                    </li>
                                ))}
                            </ul>
                            {form.fingerprint.kind === 'folder-name' ? (
                                <p className="mt-2">请改用 metadata 或文件路径指纹，或先修改实际文件夹名称。</p>
                            ) : null}
                        </div>
                    ) : null}
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-border bg-card/80 px-4 py-3">
                    <Button size="sm" variant="outline" onClick={onClose}>
                        取消
                    </Button>
                    <Button size="sm" disabled={addDisabled} onClick={() => void submit()}>
                        添加
                    </Button>
                </div>
            </div>
        </>
    );
}

function DialogField({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="text-subheading mb-1.5 block text-muted-foreground">
                {label}
            </label>
            {children}
        </div>
    );
}
