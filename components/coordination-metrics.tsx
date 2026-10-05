"use client";
import { Box, Card, CardContent, Stack, Typography } from "@mui/material";
import { coordinationEconomicMetrics } from "../lib/coordination-economics";
import { SWAP_PROFILE, type Coordination } from "../lib/coordinations";
export function CoordinationMetrics({
  items,
  profile,
}: {
  items: Coordination[];
  profile?: string;
}) {
  const metrics = coordinationEconomicMetrics(items),
    swap = profile === SWAP_PROFILE;
  const bitcoin = metrics.values.filter((value) => value.asset === "sat");
  const summary =
    bitcoin.length === 1
      ? `${bitcoin[0].completed} sat`
      : metrics.values.length === 1
        ? `${metrics.values[0].completed} ${metrics.values[0].asset}`
        : metrics.values.length
          ? "See value groups"
          : "Unavailable";
  return (
    <Stack spacing={2}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" },
          gap: 2,
        }}
      >
        {[
          [
            swap ? "Loaded swaps" : "Loaded coordinations",
            String(metrics.total),
          ],
          [
            "Recorded completion",
            metrics.completionRate === null
              ? "—"
              : `${metrics.completionRate.toFixed(1)}%`,
          ],
          ["Completed value", summary],
          ["Needs review", String(metrics.uncertain)],
        ].map(([name, value]) => (
          <Card variant="outlined" key={name}>
            <CardContent>
              <Typography color="text.secondary" variant="body2">
                {name}
              </Typography>
              <Typography
                variant="h4"
                sx={{ fontWeight: 800, mt: 1, overflowWrap: "anywhere" }}
              >
                {value}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Box>
      <Typography variant="body2" color="text.secondary">
        Recorded completion = {metrics.completed} public settled outcomes /{" "}
        {metrics.total} loaded roots. Refunded: {metrics.refunded}. Disputed:{" "}
        {metrics.disputed}. Values exclude chains with detected issues.{" "}
        {swap
          ? "Swap public transitions are checked against pontmore/swap@1."
          : "Outcomes are linked, authority-checked kernel claims; profile-specific completion conditions are not verified."}
      </Typography>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Economic value
          </Typography>
          {metrics.values.length ? (
            metrics.values.map((value) => (
              <Stack
                key={JSON.stringify([
                  value.component,
                  value.asset,
                  value.network,
                ])}
                direction={{ xs: "column", sm: "row" }}
                sx={{ justifyContent: "space-between", gap: 1, py: 1.5 }}
              >
                <Box>
                  <Typography sx={{ fontWeight: 800 }}>
                    {value.asset}
                    {value.network ? ` · ${value.network}` : ""}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {value.component}
                  </Typography>
                </Box>
                <Typography>Proposed: {value.proposed}</Typography>
                <Typography>Completed: {value.completed}</Typography>
              </Stack>
            ))
          ) : (
            <Typography color="text.secondary">
              Economic value unavailable: no eligible explicit amounts and units
              in this sample.
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            Values are public terms, not verified payments. Currencies, assets,
            networks and value components stay separate. Proposed value includes
            completed coordinations. {metrics.valued} roots have recognized
            value terms; {metrics.unavailable} are unavailable or excluded.
          </Typography>
        </CardContent>
      </Card>
    </Stack>
  );
}
