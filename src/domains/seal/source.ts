import { CorpConfig } from "../../core/config/types.js";
import { createSealClient } from "../../core/http/factory.js";
import { resolveSealEnterpriseConfig } from "../../core/auth/seal.js";
import { SealEnterpriseConfig } from "../../core/auth/types.js";
import { getMe } from "./api.js";

export async function resolveLiveSealEnterpriseConfig(
  corp: CorpConfig
): Promise<SealEnterpriseConfig> {
  const [baseConfig, client] = await Promise.all([
    resolveSealEnterpriseConfig(corp),
    createSealClient(corp)
  ]);

  const me = await getMe(client);
  return {
    ...baseConfig,
    tenantId: me.tenant.id,
    tenantSlug: me.tenant.tenantSlug ?? baseConfig.tenantSlug,
    tenantName: me.tenant.name,
    raw: {
      ...(typeof baseConfig.raw === "object" && baseConfig.raw !== null
        ? baseConfig.raw
        : {}),
      user: {
        id: me.user.id,
        name: me.user.name,
        isAdmin: me.user.isAdmin,
        providerUserId: me.user.providerUserId,
        hosecloudStaff: me.user.hosecloudStaff
      },
      tenant: me.tenant
    }
  };
}
