import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMe } from "@/lib/api.functions";
import { auth, startParam } from "@/lib/tg";
import { writeCachedPlayer } from "@/lib/player-cache";

export function usePlayer() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["me"],
    queryFn: () => getMe({ ...auth(), startParam: startParam() }),
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (q.data) writeCachedPlayer(q.data);
  }, [q.data]);
  const setPlayer = useCallback((p: Awaited<ReturnType<typeof getMe>>) => {
    qc.setQueryData(["me"], p);
    writeCachedPlayer(p);
  }, [qc]);
  return { ...q, setPlayer };
}
