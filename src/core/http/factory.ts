import ky, { HTTPError, KyInstance } from "ky";
import { CorpConfig } from "../config/types.js";
import { clearSealToken, getSealSessionForCorp } from "../auth/seal.js";

export async function createSealClient(corp: CorpConfig): Promise<KyInstance> {
  const session = await getSealSessionForCorp(corp);

  return ky.create({
    prefix: session.enterprise.sealUrl,
    timeout: 30000,
    headers: {
      Authorization: `Bearer ${session.token}`
    },
    hooks: {
      beforeError: [
        async ({ error }) => {
          if (error instanceof HTTPError && error.response.status === 401) {
            clearSealToken(corp.id);
          }
          const body =
            error instanceof HTTPError
              ? await error.response.text().catch(() => "")
              : "";
          error.message = `${error.message}${body ? `: ${body}` : ""}`;
          return error;
        }
      ]
    }
  });
}
