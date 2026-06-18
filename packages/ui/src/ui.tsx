import React, { forwardRef } from 'react';
import { Button as BaseButton } from '@base-ui/react/button';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { Select as BaseSelect } from '@base-ui/react/select';
import { Separator as BaseSeparator } from '@base-ui/react/separator';
import { Check, ChevronDown, X } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './utils.js';

export { cn } from './utils.js';

export const buttonVariants = cva(
  [
    'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium',
    'transition-[background,border-color,box-shadow,transform,opacity] duration-150 ease-[var(--ease-maka)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45',
    '[&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
        secondary: 'border border-border bg-secondary text-secondary-foreground hover:bg-muted',
        ghost: 'bg-transparent text-foreground hover:bg-muted',
        outline: 'border border-border bg-background text-foreground hover:bg-muted',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        quiet: 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
      },
      size: {
        sm: 'h-8 rounded-md px-2.5 text-xs',
        md: 'h-9 px-3',
        lg: 'h-10 rounded-lg px-4',
        icon: 'h-9 w-9 px-0',
        'icon-sm': 'h-8 w-8 px-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends Omit<React.ComponentPropsWithoutRef<typeof BaseButton>, 'className'>,
    VariantProps<typeof buttonVariants> {
  className?: string;
}

export const Button = forwardRef<HTMLElement, ButtonProps>(function Button(
  { className, variant, size, ...props },
  ref,
) {
  return (
    <BaseButton
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
});

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/10 text-primary',
        secondary: 'border-border bg-secondary text-secondary-foreground',
        success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700',
        warning: 'border-amber-500/25 bg-amber-500/10 text-amber-800',
        destructive: 'border-destructive/25 bg-destructive/10 text-destructive',
        muted: 'border-border bg-muted text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export const Card = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function Card(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn('rounded-xl border border-border bg-card text-card-foreground shadow-maka-panel', className)}
      {...props}
    />
  );
});

export const CardHeader = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function CardHeader(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn('grid gap-1.5 p-5', className)} {...props} />;
});

export const CardTitle = forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(function CardTitle(
  { className, ...props },
  ref,
) {
  return <h3 ref={ref} className={cn('text-base font-semibold tracking-normal text-foreground', className)} {...props} />;
});

export const CardDescription = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(function CardDescription(
  { className, ...props },
  ref,
) {
  return <p ref={ref} className={cn('text-sm leading-6 text-muted-foreground', className)} {...props} />;
});

export const CardContent = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function CardContent(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn('p-5 pt-0', className)} {...props} />;
});

export const inputClasses = [
  'flex min-h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm',
  'placeholder:text-muted-foreground/70',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ');

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(inputClasses, className)} {...props} />; // a11y-allow: generic wrapper; callers must provide label or aria-label
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(inputClasses, 'min-h-24 resize-y leading-6', className)} {...props} />; // a11y-allow: generic wrapper; callers must provide label or aria-label
});

export const Separator = forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof BaseSeparator>>(function Separator(
  { className, orientation = 'horizontal', ...props },
  ref,
) {
  return (
    <BaseSeparator
      ref={ref}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
});

export const DialogRoot = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;
export const DialogPortal = BaseDialog.Portal;
export const DialogTitle = BaseDialog.Title;
export const DialogDescription = BaseDialog.Description;

export const DialogBackdrop = forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof BaseDialog.Backdrop>>(function DialogBackdrop(
  { className, ...props },
  ref,
) {
  return (
    <BaseDialog.Backdrop
      ref={ref}
      className={cn('fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm', className)}
      {...props}
    />
  );
});

export const DialogPopup = forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof BaseDialog.Popup>>(function DialogPopup(
  { className, children, ...props },
  ref,
) {
  return (
    <BaseDialog.Popup
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 grid max-h-[85dvh] w-[min(92vw,640px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-maka-panel',
        className,
      )}
      {...props}
    >
      {children}
    </BaseDialog.Popup>
  );
});

export const DialogContent = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DialogPopup> & { showClose?: boolean }
>(function DialogContent({
    className,
    children,
    showClose = true,
    ...props
  },
  ref,
) {
  return (
    <DialogPortal>
      <DialogBackdrop />
      <DialogPopup ref={ref} className={className} {...props}>
        {showClose && (
          <DialogClose
            className={cn(buttonVariants({ variant: 'quiet', size: 'icon-sm' }), 'absolute right-3 top-3')}
            aria-label="关闭"
          >
            <X aria-hidden="true" />
          </DialogClose>
        )}
        {children}
      </DialogPopup>
    </DialogPortal>
  );
});

export const TabsRoot = BaseTabs.Root;
export const TabsList = forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof BaseTabs.List>>(function TabsList(
  { className, ...props },
  ref,
) {
  return <BaseTabs.List ref={ref} className={cn('inline-flex items-center rounded-lg bg-muted p-1', className)} {...props} />;
});

export const TabsTrigger = forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<typeof BaseTabs.Tab>>(function TabsTrigger(
  { className, ...props },
  ref,
) {
  return (
    <BaseTabs.Tab
      ref={ref}
      className={cn(
        'inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors data-[selected]:bg-background data-[selected]:text-foreground data-[selected]:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    />
  );
});

export const TabsPanel = forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof BaseTabs.Panel>>(function TabsPanel(
  { className, ...props },
  ref,
) {
  return <BaseTabs.Panel ref={ref} className={cn('focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)} {...props} />;
});

export const TooltipRoot = BaseTooltip.Root;
export const TooltipTrigger = BaseTooltip.Trigger;
export const TooltipPortal = BaseTooltip.Portal;
export const TooltipPositioner = BaseTooltip.Positioner;
export const TooltipPopup = forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof BaseTooltip.Popup>>(function TooltipPopup(
  { className, ...props },
  ref,
) {
  return (
    <BaseTooltip.Popup
      ref={ref}
      className={cn('z-50 rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-maka-panel', className)}
      {...props}
    />
  );
});

export const SelectRoot = BaseSelect.Root;
export const SelectTrigger = forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<typeof BaseSelect.Trigger>>(function SelectTrigger(
  { className, children, ...props },
  ref,
) {
  return (
    <BaseSelect.Trigger
      ref={ref}
      className={cn(buttonVariants({ variant: 'outline' }), 'justify-between', className)}
      {...props}
    >
      {children}
      <BaseSelect.Icon>
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  );
});

export const SelectValue = BaseSelect.Value;
export const SelectPortal = BaseSelect.Portal;
export const SelectPositioner = BaseSelect.Positioner;
export const SelectPopup = forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof BaseSelect.Popup>>(function SelectPopup(
  { className, ...props },
  ref,
) {
  return <BaseSelect.Popup ref={ref} className={cn('z-50 min-w-40 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-maka-panel', className)} {...props} />;
});

export const SelectItem = forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof BaseSelect.Item>>(function SelectItem(
  { className, children, ...props },
  ref,
) {
  return (
    <BaseSelect.Item
      ref={ref}
      className={cn('grid cursor-default grid-cols-[1rem_1fr] items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-muted data-[selected]:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50', className)}
      {...props}
    >
      <BaseSelect.ItemIndicator>
        <Check size={13} strokeWidth={2} aria-hidden="true" />
      </BaseSelect.ItemIndicator>
      <BaseSelect.ItemText>{children}</BaseSelect.ItemText>
    </BaseSelect.Item>
  );
});
