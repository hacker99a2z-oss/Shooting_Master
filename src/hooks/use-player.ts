import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMe } from "@/lib/api.functions";
import { auth, startParam } from "@/lib/tg";

export function usePlayer() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["me"],
    queryFn: () => getMe({ ...auth(), startParam: startParam() }),
    staleTime: 10_000,
  });
  return { ...q, setPlayer: (p: Awaited<ReturnType<typeof getMe>>) => qc.setQueryData(["me"], p) };
}
