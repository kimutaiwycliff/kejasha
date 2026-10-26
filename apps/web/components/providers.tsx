'use client';
import { Toaster } from '@kejasha/ui/components/sonner';
import { TooltipProvider } from '@kejasha/ui/components/tooltip';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        // Unpaid or suspended orgs can still read; any write answers 402. Say why once, with a
        // way to fix it, instead of a generic error on every form.
        mutationCache: new MutationCache({
          onError: (e) => {
            if (e instanceof ApiError && e.status === 402)
              toast.error(
                e.code === 'subscription_suspended'
                  ? 'Your subscription is suspended, so changes are paused.'
                  : 'Pay for your first month to start making changes.',
                {
                  id: 'billing-402',
                  action: {
                    label: 'Go to billing',
                    onClick: () => window.location.assign('/billing'),
                  },
                },
              );
          },
        }),
        defaultOptions: {
          queries: {
            // Client errors (4xx) are answers, not blips: don't retry them.
            retry: (count, e) => !(e instanceof ApiError && e.status < 500) && count < 2,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster richColors position="top-right" />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
