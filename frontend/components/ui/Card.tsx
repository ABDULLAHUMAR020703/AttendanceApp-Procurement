import { cn } from '@/lib/ui';

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('bg-card rounded-2xl shadow-sm border border-white/10 p-6', className)}>{children}</div>;
}
