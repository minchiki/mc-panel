import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser, requireUser } from "../auth/guard.js";
import { chat } from "../ai/assistant.js";
import { audit } from "../lib/audit.js";
import { parse } from "../lib/validate.js";

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  // Free models have tight shared limits: a few questions a minute per user is plenty.
  app.post("/api/ai/chat", { preHandler: requireUser, bodyLimit: 128 * 1024, config: { rateLimit: { max: 8, timeWindow: "1 minute" } } }, async (req) => {
    const body = parse(
      z.object({
        serverId: z.string().max(40).optional(),
        messages: z
          .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(6000) }))
          .min(1)
          .max(24),
      }),
      req.body,
    );
    const user = currentUser(req);
    const result = await chat(user, body.serverId, body.messages.slice(-16));
    audit({ userId: user.id, serverId: body.serverId ?? null, action: "ai.chat", details: { steps: result.steps.length, actions: result.actions.length }, ip: req.ip });
    return result;
  });
}
