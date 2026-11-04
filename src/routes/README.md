# Routes

The app uses TanStack Router file-based routes in a static Vite + React SPA.

| File | URL |
| --- | --- |
| index.tsx | / |
| leaderboard.tsx | /leaderboard |
| refer.tsx | /refer |
| withdraw.tsx | /withdraw |
| __root.tsx | Shared app shell |

The route tree is generated in routeTree.gen.ts. When adding or renaming a route, use the TanStack Router generator and commit the generated route tree.
