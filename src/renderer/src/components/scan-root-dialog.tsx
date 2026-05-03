import { useEffect, useState } from 'react';
import { Minus, Plus, FolderEdit, FolderRoot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EditDialogField, EditDialogShell } from '@/components/ui/edit-dialog-shell';
import { useAppActions } from '../store/app-store.js';

export function DepthStepper({
    value,
    onChange,
    min = 1,
    max = 10,
}: {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
}) {
    const dec = () => onChange(Math.max(min, value - 1));
    const inc = () => onChange(Math.min(max, value + 1));

    return (
        <div className="inline-flex h-8 items-center overflow-hidden rounded-lg border border-border bg-background">
            <button
                type="button"
                onClick={dec}
                className="inline-flex h-full w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                disabled={value <= min}
                aria-label="减少深度"
            >
                <Minus className="size-4" />
            </button>
            <div className="flex h-full min-w-10 items-center justify-center border-x border-border px-3 text-subheading tabular-nums text-foreground">
                {value}
            </div>
            <button
                type="button"
                onClick={inc}
                className="inline-flex h-full w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                disabled={value >= max}
                aria-label="增加深度"
            >
                <Plus className="size-4" />
            </button>
        </div>
    );
}

export function AddScanRootDialog({
    directoryPath,
    existingRoot,
    onClose,
}: {
    directoryPath: string;
    existingRoot?: { id: string; maxDepth: number };
    onClose: () => void;
}) {
    const actions = useAppActions();
    const [selectedPath, setSelectedPath] = useState(directoryPath);
    const [maxDepth, setMaxDepth] = useState(existingRoot?.maxDepth ?? 3);
    const [busy, setBusy] = useState(false);
    const editing = !!existingRoot;

    useEffect(() => {
        setSelectedPath(directoryPath);
    }, [directoryPath]);

    const repickDirectory = async () => {
        const dir = await actions.pickDirectory();
        if (!dir) return;
        setSelectedPath(dir);
    };

    const submit = async (scanAfterAdd: boolean) => {
        if (busy) return;
        setBusy(true);
        try {
            const root = editing
                ? await actions.updateScanRoot(existingRoot.id, { path: selectedPath, maxDepth }).then(() => ({ id: existingRoot.id }))
                : await actions.addScanRoot({ path: selectedPath, maxDepth });
            if (scanAfterAdd) {
                await actions.runScanOne(root.id);
            }
            actions.toast(
                'success',
                editing
                    ? scanAfterAdd
                        ? '扫描目录设置已保存并开始扫描'
                        : '扫描目录设置已保存'
                    : scanAfterAdd
                        ? '扫描目录已添加并开始扫描'
                        : '扫描目录已添加',
            );
            onClose();
        } catch (error) {
            actions.toast('error', error instanceof Error ? error.message : editing ? '保存扫描目录设置失败' : '添加扫描目录失败');
        } finally {
            setBusy(false);
        }
    };

    return (
        <EditDialogShell
            title={editing ? '扫描目录设置' : '添加扫描目录'}
            note="目录会作为扫描起点保存到配置中，后续也可以随时回来修改。"
            onClose={onClose}
            panelClassName="w-[min(520px,calc(100vw-2rem))]"
            bodyClassName="space-y-5"
            footerEnd={(
                <>
                    <Button size="sm" variant="outline" onClick={onClose}>
                        取消
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void submit(false)}>
                        {editing ? '保存设置' : '添加'}
                    </Button>
                    <Button size="sm" disabled={busy} onClick={() => void submit(true)}>
                        {editing ? '保存并扫描' : '添加并扫描'}
                    </Button>
                </>
            )}
        >
            <EditDialogField label="已选择目录" note="此目录将作为扫描起点保存到配置中。">
                <div className="flex min-h-9 items-center gap-2 rounded-lg border border-border bg-background pr-1.5 pl-3 text-note text-foreground">
                    <FolderRoot className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 break-all py-2">{selectedPath}</span>
                    <Button size="icon-xs" variant="ghost" onClick={() => void repickDirectory()} title="重新选择目录">
                        <FolderEdit className="size-3.5" />
                    </Button>
                </div>
            </EditDialogField>

            <EditDialogField label="扫描深度" note="根目录记为 1；层级越深，扫描范围越大。">
                <DepthStepper value={maxDepth} onChange={setMaxDepth} />
            </EditDialogField>
        </EditDialogShell>
    );
}
