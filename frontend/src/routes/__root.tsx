import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, Link, createRootRouteWithContext, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return <div className="flex min-h-screen items-center justify-center bg-background px-4"><div className="max-w-md text-center"><h1 className="text-7xl text-foreground">404</h1><h2 className="mt-4 text-xl text-foreground">Page not found</h2><Link to="/" className="mt-6 inline-flex rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Go home</Link></div></div>;
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  return <div className="flex min-h-screen items-center justify-center bg-background px-4"><div className="max-w-md text-center"><h1 className="text-xl text-foreground">This page didn't load</h1><p className="mt-2 text-sm text-muted-foreground">Something went wrong. Try again.</p><button onClick={() => { router.invalidate(); reset(); }} className="mt-6 inline-flex rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Try again</button></div></div>;
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => {
    const wa = window.Telegram?.WebApp;
    if (!wa) return;
    wa.ready();
    wa.expand();
    try { wa.setHeaderColor?.("#0f1d26"); wa.setBackgroundColor?.("#0f1d26"); wa.disableVerticalSwipes?.(); } catch {}
  }, []);
  return <QueryClientProvider client={queryClient}><Outlet /><Toaster position="top-center" /></QueryClientProvider>;
}
