import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMe } from "@/lib/api.functions";
import { auth, startParam } from "@/lib/tg";

export function usePlayer() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["me"],
    queryFn: () => getMe({ ...auth(), startParam: startParam() }),
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
  const setPlayer = useCallback((p: Awaited<ReturnType<typeof getMe>>) => qc.setQueryData(["me"], p), [qc]);
  return { ...q, setPlayer };
}
