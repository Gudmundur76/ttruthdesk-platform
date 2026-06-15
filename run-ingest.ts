import { runDomainIngest } from "./server/domainIngestScheduler";
async function main() {
  console.info("Running domain ingest...");
  const results = await runDomainIngest();
  console.info(JSON.stringify(results, null, 2));
  process.exit(0);
}
main().catch(console.error);
