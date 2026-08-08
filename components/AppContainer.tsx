import { cn } from '@/lib/utils';

type AppContainerProps = React.ComponentProps<'div'>;

export function AppContainer({ className, ...props }: AppContainerProps) {
  return (
    <div
      className={cn('mx-auto w-full max-w-[var(--app-max-width)] px-4 sm:px-6 lg:px-8', className)}
      {...props}
    />
  );
}
