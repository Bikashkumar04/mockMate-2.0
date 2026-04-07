"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function ReactQueryProvider({ children }: { children: React.ReactNode }) {
  // One client per session — created lazily so it's never shared across requests
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Always treat cached data as stale so refetchOnMount /
            // refetchOnWindowFocus always trigger a background re-fetch.
            staleTime: 0,
            // Keep unused data in cache for 10 minutes
            gcTime: 10 * 60 * 1000,
            // Re-fetch whenever the component mounts
            refetchOnMount: true,
            // Re-fetch whenever the browser tab regains focus
            refetchOnWindowFocus: true,
            // Don't retry network errors more than once
            retry: 1,
          },
        },
      })
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
