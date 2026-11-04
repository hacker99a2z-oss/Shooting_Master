import { createElement as h } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { getLeaderboard } from "@/lib/api.functions";
import { auth } from "@/lib/tg";
export const Route = createFileRoute("/leaderboard")({ component: Page });
function Page() {
  const q = useQuery({ queryKey:["leaderboard"], queryFn:()=>getLeaderboard(auth()), refetchInterval:30000 });
  return h(AppShell,{title:"Leaderboard"},q.isLoading?h("p",null,"Loading…"):q.error?h("p",null,(q.error as Error).message):h("div",{className:"space-y-2"},...(q.data?.list??[]).map(x=>h("div",{key:x.tgId,className:"rounded-2xl border bg-card p-3"},h("b",null,"#"+x.rank+" "+x.name),h("p",null,x.coins.toLocaleString()+" coins · $"+x.prize.toFixed(2))))));
}
