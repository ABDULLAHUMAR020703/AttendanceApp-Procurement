import { cn } from '@/lib/ui';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export function Button({ className, variant = 'primary', type = 'button', ...props }: ButtonProps) {
  const variantClass =
    variant === 'secondary'
      ? 'border border-white/20 bg-transparent hover:bg-white/5'
      : variant === 'danger'
        ? 'bg-rose-600 hover:bg-rose-700'
        : variant === 'success'
          ? 'bg-emerald-600 hover:bg-emerald-700'
          : 'bg-purple-600 hover:bg-purple-700';

  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors',
        'disabled:opacity-60 disabled:cursor-not-allowed',
        variantClass,
        className,
      )}
      {...props}
    />
  );
}
