import { describe, expect, it } from "vitest";
import { facingTarget, joystickVector, releaseShot, shortestAngle } from "../lib/game-controls";
import { createArenaNavigation } from "../lib/arena-navigation";
import { BSC_CHAIN_ID, trustBrowserLink, validBep20Address } from "../lib/wallet-rules";

describe("requested game controls", () => {
  it.each([[45, 0, 1, 0], [-45, 0, -1, 0], [0, -45, 0, -1], [0, 45, 0, 1]])("joystick moves in direction %s,%s", (x, y, vx, vy) => expect(joystickVector(x, y)).toEqual({ x: vx, y: vy }));
  it("shoot turns the character toward aim while moving", () => expect(facingTarget({x:1,y:0}, true, -Math.PI/2, false, 0, 0)).toBe(-Math.PI/2));
  it("shield turns the character toward shield while moving", () => expect(facingTarget({x:1,y:0}, false, 0, true, Math.PI, 0)).toBe(Math.PI));
  it("cancelled touch never shoots", () => expect(releaseShot(true, true)).toBe(false));
  it("released held touch shoots once", () => expect(releaseShot(true, false)).toBe(true));
  it("rotation takes the short path across angle wrap", () => expect(Math.abs(shortestAngle(3.1, -3.1))).toBeLessThan(0.1));
  it("enemies route around a blocking obstacle", () => {
    const nav = createArenaNavigation(360, 300, [{x:130,y:80,w:100,h:120}]);
    const route = nav.route({x:80,y:160}, {x:280,y:160});
    expect(route.length).toBeGreaterThan(2);
    expect(route.some(p => p.y < 96 || p.y > 220)).toBe(true);
    expect(route.every(p => !nav.blocked(p.x,p.y))).toBe(true);
  });
});
describe("USDT BEP20 destination", () => {
  it("uses BNB Smart Chain 56", () => expect(BSC_CHAIN_ID).toBe(56));
  it("rejects non-EVM and zero payout destinations", () => { expect(validBep20Address("T123456789012345678901234567890123456")).toBe(false); expect(validBep20Address("0x"+"0".repeat(40))).toBe(false); expect(validBep20Address("0x"+"a".repeat(40))).toBe(true); });
  it("opens Trust's documented EVM browser without session data", () => { const link = new URL(trustBrowserLink("https://game.example/withdraw?tgWebAppData=private#secret")); expect(link.searchParams.get("coin_id")).toBe("60"); expect(link.searchParams.get("url")).toBe("https://game.example/withdraw"); });
});