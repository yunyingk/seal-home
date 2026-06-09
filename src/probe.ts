import { getEnterprisesDirCandidates, loadCorpConfigs } from "./core/config/loader.js";
import { createSealClient } from "./core/http/factory.js";
import { resolveLiveSealEnterpriseConfig } from "./domains/seal/source.js";
import { getApprovalContext } from "./domains/seal/api.js";

async function main() {
  const corpId = Bun.argv[2];
  const corps = loadCorpConfigs();
  const corp = corpId
    ? corps.find((item) => item.id === corpId)
    : corps[0];

  if (!corp) {
    throw new Error(
      corpId
        ? `No enterprise config found for ${corpId}`
        : `No enterprise config found. Add a config file under one of: ${getEnterprisesDirCandidates().join(", ")}`
    );
  }

  console.log(`[probe] corp=${corp.id} source=${corp.source.type}`);

  const enterprise = await resolveLiveSealEnterpriseConfig(corp);
  console.log("[probe] seal enterprise");
  console.log(JSON.stringify(enterprise, null, 2));

  const client = await createSealClient(corp);
  const context = await getApprovalContext(client, {
    documentLimit: 20,
    stylePreferencesEndpoint: corp.seal.endpoints.approvalStylePreferences
  });

  console.log("[probe] approval context summary");
  console.log(JSON.stringify({
    rules: context.rules.rules.length,
    hasPendingRuleDeletes: context.rules.hasPendingDeletes,
    documents: context.documents.articles.length,
    documentsTotal: context.documents.total,
    stylePreferences: context.stylePreferences.ok
      ? "ok"
      : `error: ${context.stylePreferences.error}`
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
