import { cn } from '@/lib/ui';

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        'w-full rounded-lg border border-white/10 bg-[#2a2640] px-3 py-2 text-sm text-white placeholder:text-slate-400',
        'outline-none focus:ring-2 focus:ring-purple-500/70 focus:border-purple-400/70',
        className,
      )}
      {...props}
    />
  );
}
