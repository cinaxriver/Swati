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
      const maxIter = (c.input.maxIterations ?? 3);
      // researcher drafts a proposal.
      const proposal = await researcher.do(
        `Write a concise research proposal for the topic: "${c.input.topic}". ` +
        `Output only the proposal text, no preamble.`
      ) as string;

      await c.send(proposal, "researcher", "critic");

      while (iterations < maxIter) {
        iterations++;

        // critic reviews the proposal.
        const review = await critic.do(
          `Review this research proposal and decide whether to APPROVE or REVISE it.\n\n` +
          `Proposal:\n${proposal}\n\n` +
          `If APPROVE: explain why it is strong enough to execute.\n` +
          `If REVISE: provide specific feedback for improvement.\n` +
          `Start your response with the decision word.`
        ) as string;

        await c.send(review, "critic", "researcher");
        await c.send(review, "critic", "executor");

        // critic decides: approve or revise.
        // choose() broadcasts the decision to all roles (knowledge-of-choice).
        const decision = await c.choose("critic", ["approve", "revise"] as const, review);

        if (decision === "approve") {
          // executor carries out the approved proposal.
          const executionResult = await c.gate("executor", "local", async () => {
            const output = await c.roles["executor"].do(
              `Execute this approved research proposal and summarize what was done:\n\n${proposal}`
            );
            return output;
          });

          // executor sends its result; researcher receives it via send's return value.
          // non-gate roles get ok(null) from gate(), so the actual summary
          // arrives through the send channel rather than executionResult.
          const sentSummary = executionResult.ok ? String(executionResult.value) : "execution failed";
          const summary = (await c.send(sentSummary, "executor", "researcher") as string | undefined) ?? sentSummary;
          await c.persist("last-result", summary);

          return { result: summary, iterations };
        }

        // revise path: researcher refines based on critic feedback.
        const revised = await researcher.do(
          `revise your research proposal based on this critic feedback:\n\n${review}\n\n` +
          `original proposal:\n${proposal}\n\nOutput only the revised proposal text.`
        ) as string;

        await c.send(revised, "researcher", "critic");
      }

      // exhausted iterations without approval — return last draft.
      return { result: proposal, iterations };
    },
  }
);
