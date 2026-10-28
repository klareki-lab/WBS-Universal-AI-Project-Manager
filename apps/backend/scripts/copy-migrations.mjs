import { cpSync, mkdirSync } from "node:fs";
mkdirSync("dist/apps/backend", { recursive: true });
cpSync("migrations", "dist/apps/backend/migrations", { recursive: true });
