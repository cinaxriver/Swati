import { choreography } from "@swati/core";

export interface ResearchInput {
  topic: string;
  maxIterations?: number;
}

export default choreography<ResearchInput, { result: string; iterations: number }>(
  "research-collab",
  {
    roles: ["researcher", "critic", "executor"],

    async flow(c) {
      const { researcher, critic } = c.roles;
      let iterations = 0;
      const maxIter = c.input.maxIterations ?? 3;

      const proposal = (await researcher.do(
        `Write a concise research proposal for the topic: "${c.input.topic}". ` +
          `Output only the proposal text, no preamble.`,
      )) as string;

      await c.send(proposal, "researcher", "critic");

      while (iterations < maxIter) {
        iterations++;

        const review = (await critic.do(
          `Review this research proposal and decide whether to APPROVE or REVISE it.\n\n` +
            `Proposal:\n${proposal}\n\n` +
            `If APPROVE: explain why it is strong enough to execute.\n` +
            `If REVISE: provide specific feedback for improvement.\n` +
            `Start your response with the decision word.`,
        )) as string;

        await c.send(review, "critic", "researcher");
        await c.send(review, "critic", "executor");

        const decision = await c.choose("critic", ["approve", "revise"] as const, review);

        if (decision === "approve") {
          const executionResult = await c.gate("executor", "local", async () => {
            const output = await c.roles["executor"].do(
              `Execute this approved research proposal and summarize what was done:\n\n${proposal}`,
            );
            return output;
          });

          const sentSummary = executionResult.ok
            ? String(executionResult.value)
            : "execution failed";
          const summary =
            ((await c.send(sentSummary, "executor", "researcher")) as string | undefined) ??
            sentSummary;
          await c.persist("last-result", summary);

          return { result: summary, iterations };
        }

        const revised = (await researcher.do(
          `Revise your research proposal based on this critic feedback:\n\n${review}\n\n` +
            `Original proposal:\n${proposal}\n\nOutput only the revised proposal text.`,
        )) as string;

        await c.send(revised, "researcher", "critic");
      }

      return { result: proposal, iterations };
    },
  },
);
