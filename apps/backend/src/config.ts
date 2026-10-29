import { z } from "zod";
const env = z.object({
  DATABASE_URL: z.url(),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(13081),
  COOKIE_SECURE: z.enum(["true", "false"]).default("true"),
  ALLOWED_ORIGIN: z.url(),
  N8N_ENDPOINT: z.union([z.literal(""), z.url()]).default(""),
  N8N_TOKEN: z.string().default(""),
});
export function configuration() {
  const c = env.parse(process.env);
  if (c.N8N_ENDPOINT && !c.N8N_TOKEN)
    throw new Error("N8N_TOKEN required with N8N_ENDPOINT");
  return c;
}
