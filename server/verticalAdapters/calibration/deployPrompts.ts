/**
 * deployPrompts.ts
 * Deploys all adapter prompt rewrites to the adapter_prompt_versions table.
 *
 * Usage: pnpm prompts:deploy
 *
 * Behaviour:
 * - Iterates over ADAPTERS_NEEDING_REWRITE (G1 + G2 + G3, 68 adapters)
 * - Calls savePromptVersion() for each — this deactivates the previous active
 *   version and inserts a new one with isActive=true
 * - Skips G4 adapters (their existing prompts are already working)
 * - Prints a summary table on completion
 */

import { ADAPTER_PROMPT_REWRITES, ADAPTERS_NEEDING_REWRITE } from "./adapterPromptRewrites";
import { savePromptVersion, getActivePromptVersion } from "./promptRegistry";

interface DeployResult {
  adapterId: string;
  group: string;
  version: number;
  status: "deployed" | "skipped" | "error";
  error?: string;
}

async function deploy(): Promise<void> {
  console.log("\n🚀  Protein Truth Desk — Prompt Rewrite Deployment");
  console.log("─".repeat(60));
  console.log(`  Adapters to deploy : ${ADAPTERS_NEEDING_REWRITE.length}`);
  console.log("─".repeat(60));

  const results: DeployResult[] = [];
  let deployed = 0;
  let errors = 0;

  for (const adapterKey of ADAPTERS_NEEDING_REWRITE) {
    const rewrite = ADAPTER_PROMPT_REWRITES[adapterKey];
    if (!rewrite || !rewrite.prompt) {
      results.push({ adapterId: adapterKey, group: "?", version: 0, status: "skipped" });
      continue;
    }

    try {
      const current = await getActivePromptVersion(adapterKey);
      const version = await savePromptVersion(adapterKey, rewrite.prompt, rewrite.group);
      const prevVersion = current?.version ?? 0;
      console.log(
        `  ✅  [${rewrite.group}] ${adapterKey.padEnd(30)} v${prevVersion} → v${version}`
      );
      results.push({ adapterId: adapterKey, group: rewrite.group, version, status: "deployed" });
      deployed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ❌  [${rewrite.group}] ${adapterKey.padEnd(30)} ERROR: ${message}`);
      results.push({
        adapterId: adapterKey,
        group: rewrite.group,
        version: 0,
        status: "error",
        error: message,
      });
      errors++;
    }
  }

  console.log("─".repeat(60));
  console.log(`\n  Deployed : ${deployed}`);
  console.log(`  Errors   : ${errors}`);
  console.log(`  Skipped  : ${results.filter((r) => r.status === "skipped").length}`);

  // Group summary
  const groups = ["G1", "G2", "G3"] as const;
  console.log("\n  Group breakdown:");
  for (const g of groups) {
    const count = results.filter((r) => r.group === g && r.status === "deployed").length;
    console.log(`    ${g}: ${count} adapters deployed`);
  }

  console.log("\n  Run 'pnpm calibrate:adapters' to verify improvement.\n");

  if (errors > 0) {
    process.exit(1);
  }
}

deploy().catch((err) => {
  console.error("Fatal deploy error:", err);
  process.exit(1);
});
