import type { ComponentProps } from 'react'
import { cn } from 'cn'

/** Native form semantics for existing forms, including selectOption and FormData. */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <select data-slot="native-select" className={cn('h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50', className)} {...props}/>
}
