import * as React from 'react';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

function Breadcrumb({ className, ...props }: React.ComponentPropsWithoutRef<'nav'>) {
    return <nav aria-label="breadcrumb" className={cn('min-w-0', className)} {...props} />;
}

function BreadcrumbList({ className, ...props }: React.ComponentPropsWithoutRef<'ol'>) {
    return (
        <ol
            className={cn('flex min-w-0 items-center gap-1.5 text-note text-muted-foreground', className)}
            {...props}
        />
    );
}

function BreadcrumbItem({ className, ...props }: React.ComponentPropsWithoutRef<'li'>) {
    return <li className={cn('inline-flex min-w-0 items-center gap-1.5', className)} {...props} />;
}

type BreadcrumbLinkProps = React.ComponentPropsWithoutRef<'a'> & {
    render?: React.ReactElement<{ className?: string; children?: React.ReactNode }>;
};

function BreadcrumbLink({ className, render, children, ...props }: BreadcrumbLinkProps) {
    if (render) {
        const renderProps = render.props;
        return React.cloneElement(render, {
            ...props,
            className: cn('transition-colors hover:text-foreground', renderProps.className, className),
            children,
        });
    }

    return (
        <a
            className={cn('transition-colors hover:text-foreground', className)}
            {...props}
        >
            {children}
        </a>
    );
}

function BreadcrumbPage({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) {
    return <span aria-current="page" className={cn('truncate text-foreground', className)} {...props} />;
}

function BreadcrumbSeparator({ className, children, ...props }: React.ComponentPropsWithoutRef<'li'>) {
    return (
        <li
            aria-hidden="true"
            className={cn('inline-flex items-center text-muted-foreground/70', className)}
            {...props}
        >
            {children ?? <ChevronRight className="size-3.5" />}
        </li>
    );
}

function BreadcrumbEllipsis({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) {
    return (
        <span className={cn('inline-flex size-8 items-center justify-center', className)} {...props}>
            <MoreHorizontal className="size-4" />
            <span className="sr-only">更多</span>
        </span>
    );
}

export {
    Breadcrumb,
    BreadcrumbEllipsis,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
};
