import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl text-foreground">404</h1>
        <h2 className="mt-4 text-xl text-foreground">Page not found</h2>
        <div className="mt-6">
          <Link to="/" className="inline-flex rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl text-foreground">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">Something went wrong. Try again.</p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-6 inline-flex rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" },
      { title: "Coin Rush" },
      { name: "description", content: "Play Coin Rush daily on Telegram and earn rewards." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Lilita+One&family=Outfit:wght@400;500;600;700&display=swap" },
    ],
    scripts: [
      { src: "https://telegram.org/js/telegram-web-app.js" },
      { src: "https://sad.adsgram.ai/js/sad.min.js" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => {
    const wa = window.Telegram?.WebApp;
    if (!wa) return;
    wa.ready();
    wa.expand();
    try { wa.setHeaderColor?.("#0f1d26"); wa.setBackgroundColor?.("#0f1d26"); wa.disableVerticalSwipes?.(); } catch {}
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster position="top-center" />
    </QueryClientProvider>
  );
}
