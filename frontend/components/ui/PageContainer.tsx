import { cn } from '@/lib/ui';

export function PageContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('max-w-7xl mx-auto px-6 py-8', className)}>{children}</div>;
}
