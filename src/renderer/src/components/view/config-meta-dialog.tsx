import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EditDialogField, EditDialogShell } from '@/components/ui/edit-dialog-shell';

export function ConfigMetaDialog({
    initialName,
    initialDescription,
    onClose,
    onSave,
}: {
    initialName: string;
    initialDescription: string;
    onClose: () => void;
    onSave: (name: string, description: string) => Promise<void>;
}) {
    const [name, setName] = useState(initialName);
    const [description, setDescription] = useState(initialDescription);
    const [busy, setBusy] = useState(false);

    return (
        <EditDialogShell
            title="编辑配置元信息"
            onClose={onClose}
            panelClassName="w-[min(520px,calc(100vw-2rem))]"
            bodyClassName="space-y-4"
            footerEnd={(
                <>
                    <Button size="sm" variant="outline" onClick={onClose}>
                        取消
                    </Button>
                    <Button
                        size="sm"
                        disabled={busy || !name.trim()}
                        onClick={async () => {
                            setBusy(true);
                            try {
                                await onSave(name, description);
                            } finally {
                                setBusy(false);
                            }
                        }}
                    >
                        保存
                    </Button>
                </>
            )}
        >
            <EditDialogField label="名称">
                <input
                    value={name}
                    onChange={event => setName(event.target.value)}
                    className="h-9 w-full rounded-lg border border-border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
            </EditDialogField>

            <EditDialogField label="描述">
                <textarea
                    rows={3}
                    value={description}
                    onChange={event => setDescription(event.target.value)}
                    placeholder="可选，用于标题栏悬浮信息说明"
                    className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
            </EditDialogField>
        </EditDialogShell>
    );
}