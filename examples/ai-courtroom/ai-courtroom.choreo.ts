import { choreography } from "@swati/core";

export interface CaseBrief {
  accusation: string;
}

export interface Ruling {
  accusation: string;
  prosecution: string;
  defense: string;
  verdict: "guilty" | "not-guilty" | "insufficient-evidence";
}

export default choreography<CaseBrief, Ruling>("ai-courtroom", {
  roles: ["prosecutor", "defender", "judge"],

  async flow(c) {
    const { prosecutor, defender, judge } = c.roles;

    const opening = (await prosecutor.do(
      `You are a DeFi security prosecutor. In one sentence, state your case ` +
        `against the following alleged exploit:\n"${c.input.accusation}"`,
    )) as string;

    const openingForJudge = (await c.send(opening, "prosecutor", "judge")) as string;
    const openingForDefender = (await c.send(opening, "prosecutor", "defender")) as string;

    const rebuttal = (await defender.do(
      `You are a blockchain defense attorney. In one sentence, rebut this ` +
        `prosecution statement:\n"${openingForDefender}"`,
    )) as string;

    const rebuttalForJudge = (await c.send(rebuttal, "defender", "judge")) as string;

    const verdict = await c.choose(
      "judge",
      ["guilty", "not-guilty", "insufficient-evidence"] as const,
      {
        accusation: c.input.accusation,
        prosecution: openingForJudge,
        defense: rebuttalForJudge,
      },
    );

    await c.gate("judge", "local", async () => {
      return `VERDICT: ${verdict.toUpperCase()} — ${c.input.accusation}`;
    });

    await c.persist("last-verdict", verdict);

    return {
      accusation: c.input.accusation,
      prosecution: openingForJudge,
      defense: rebuttalForJudge,
      verdict,
    };
  },
});
