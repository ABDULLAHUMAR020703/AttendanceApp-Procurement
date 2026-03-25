import { cn } from '@/lib/ui';

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return <table className={cn('w-full text-sm', className)}>{children}</table>;
}

export function TableWrapper({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('overflow-x-auto', className)}>{children}</div>;
}

export function THead({ children, className }: { children: React.ReactNode; className?: string }) {
  return <thead className={cn('text-muted-foreground uppercase tracking-wide text-xs', className)}>{children}</thead>;
}

export function TBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <tbody className={cn('divide-y divide-white/10', className)}>{children}</tbody>;
}

export function TR({ children, className }: { children: React.ReactNode; className?: string }) {
  return <tr className={cn('hover:bg-white/5 transition-colors', className)}>{children}</tr>;
}

export function TH({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn('text-left font-medium px-4 py-3', className)}>{children}</th>;
}

export function TD({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('px-4 py-3', className)}>{children}</td>;
}
