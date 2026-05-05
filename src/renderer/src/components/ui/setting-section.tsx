import type { ReactNode } from 'react';

export function SettingSection({
    title,
    hint,
    children,
}: {
    title: string;
    hint?: string;
    children: ReactNode;
}) {
    return (
        <section>
            <h2 className="text-heading text-foreground">{title}</h2>
            {hint ? <p className="mt-1 text-note text-muted-foreground">{hint}</p> : null}
            <div className="mt-3.5">{children}</div>
        </section>
    );
}