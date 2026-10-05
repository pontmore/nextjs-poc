import { addDecimal, type Coordination } from "./coordinations";
export type EconomicValue = {
  component: string;
  asset: string;
  network: string;
  amount: string;
};
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function amount(value: unknown): string | null {
  const text =
    typeof value === "string"
      ? value
      : typeof value === "number" && Number.isSafeInteger(value)
        ? String(value)
        : "";
  return text.length <= 100 && /^\d+(\.\d+)?$/.test(text) && /[1-9]/.test(text)
    ? text
    : null;
}
function identifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,95}$/.test(value)
  );
}
export function economicValues(item: Coordination): EconomicValue[] {
  if (item.swap)
    return [
      {
        component: "Fiat",
        asset: item.swap.fiat.currency,
        network: "",
        amount: item.swap.fiat.amount,
      },
      {
        component: "Bitcoin",
        asset: "sat",
        network: item.swap.bitcoin.network,
        amount: item.swap.bitcoin.amount,
      },
    ];
  if (item.profile === "rollpot/game@1") {
    const stake = amount(item.terms.amount_sats);
    if (
      !stake ||
      !/^\d+$/.test(stake) ||
      item.terms.funding_model !== "2_of_2" ||
      item.terms.payout_network !== "lightning" ||
      !item.roles["game/player1"] ||
      !item.roles["game/player2"] ||
      item.roles["game/player1"] === item.roles["game/player2"]
    )
      return [];
    return [
      {
        component: "Two-player pot",
        asset: "sat",
        network: "lightning",
        amount: (BigInt(stake) * BigInt(2)).toString(),
      },
    ];
  }
  const values: EconomicValue[] = [];
  function visit(terms: Record<string, unknown>, path: string, depth: number) {
    if (depth > 4 || values.length >= 32) return;
    const value = amount(terms.amount),
      asset = terms.currency ?? terms.unit ?? terms.asset;
    if (value && identifier(asset)) {
      values.push({
        component: path,
        asset: asset === "sats" ? "sat" : asset,
        network: identifier(terms.network) ? terms.network : "",
        amount: value,
      });
      return;
    }
    for (const [key, child] of Object.entries(terms)) {
      if (record(child)) visit(child, `${path}.${key}`, depth + 1);
      else if (key.endsWith("_sats")) {
        const sats = amount(child);
        if (sats && /^\d+$/.test(sats))
          values.push({
            component: `${path}.${key}`,
            asset: "sat",
            network: identifier(terms.payout_network)
              ? terms.payout_network
              : "",
            amount: sats,
          });
      }
      if (values.length >= 32) break;
    }
  }
  visit(item.terms, "terms", 0);
  return values;
}
export function coordinationEconomicMetrics(items: Coordination[]) {
  const unique = [...new Map(items.map((c) => [c.root.id, c])).values()];
  const completed = unique.filter(
    (c) => !c.issues.length && ["settled", "settled_claimed"].includes(c.state),
  );
  const values = new Map<
    string,
    EconomicValue & { proposed: string; completed: string }
  >();
  let valued = 0;
  for (const item of unique.filter((c) => !c.issues.length)) {
    const components = economicValues(item);
    if (components.length) valued += 1;
    for (const value of components) {
      const key = JSON.stringify([value.component, value.asset, value.network]);
      const bucket = values.get(key) || {
        ...value,
        proposed: "0",
        completed: "0",
      };
      bucket.proposed = addDecimal(bucket.proposed, value.amount);
      if (["settled", "settled_claimed"].includes(item.state))
        bucket.completed = addDecimal(bucket.completed, value.amount);
      values.set(key, bucket);
    }
  }
  return {
    total: unique.length,
    completed: completed.length,
    completionRate: unique.length
      ? (completed.length / unique.length) * 100
      : null,
    refunded: unique.filter((c) =>
      ["refunded", "refunded_claimed"].includes(c.state),
    ).length,
    disputed: unique.filter((c) =>
      ["disputed", "disputed_claimed"].includes(c.state),
    ).length,
    uncertain: unique.filter((c) => c.issues.length).length,
    valued,
    unavailable: unique.length - valued,
    values: [...values.values()].sort((a, b) =>
      `${a.asset}:${a.network}:${a.component}`.localeCompare(
        `${b.asset}:${b.network}:${b.component}`,
      ),
    ),
  };
}
