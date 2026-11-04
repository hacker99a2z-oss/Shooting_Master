import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMe } from "@/lib/api.functions";
import { auth, startParam } from "@/lib/tg";

export function usePlayer() {
  const fn = useServerFn(getMe);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["me"],
    queryFn: () => fn({ data: { ...auth(), startParam: startParam() } }),
    staleTime: 10_000,
  });
  return { ...q, setPlayer: (p: Awaited<ReturnType<typeof getMe>>) => qc.setQueryData(["me"], p) };
}
