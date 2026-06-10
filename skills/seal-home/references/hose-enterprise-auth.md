# Hose Enterprise Auth

Use this reference for Hose/合思 enterprise configuration and user-facing Hose authorization links.

## Add or switch an enterprise

Use the CLI for normal enterprise setup. Do not inspect source code or hand-edit `~/.config/seal-home/enterprises/*.json` unless the CLI fails or the user explicitly asks for low-level config debugging.

```bash
seal-home corps add-hose --json '{"name":"企业名称","domain":"https://app.ekuaibao.com","appKey":"...","appSecurity":"...","proxyStaffBizId":"corpId:staffId"}'
seal-home corps list
seal-home corps current
seal-home corps switch <corpId>
```

`corps add-hose` verifies by default and writes the enterprise config. If the user says not to operate business logic, stop at `corps` and auth/config commands; do not run approval, rule, document, simulation, or approval-run commands.

## Diagnose authentication

```bash
seal-home auth diagnose --corp <corpId>
```

Read the JSON `stages` in order:

- `hose.openapi`: appKey/appSecurity can get a Hose OpenAPI token and corporation ID.
- `hose.provisional`: `proxyStaffBizId`/staff ID can get a provisional auth URL.
- `seal.sso`: Seal accepts the Hose provisional token and returns a bearer session.
- `seal.whoami`: the Seal bearer can read current user and tenant.

Do not expect tokens in the output; the command intentionally redacts or omits them.

## Get a Hose authorization link

When the user asks for a 合思/易快报授权链接、登录链接、入口链接, or says "来一个授权链接" for a Hose sourced enterprise, return the Hose provisional/CloseAPI URL from `getProvisionalAuth`'s `value.message`.

Flow:

1. Obtain an OpenAPI token with appKey/appSecurity:

```text
POST /api/openapi/v1/auth/getAccessToken
body: {"appKey":"...","appSecurity":"..."}
```

2. Call provisional auth:

```text
POST /api/openapi/v1.1/provisional/getProvisionalAuth?accessToken=<openapi-token>
body: {"uid":"corpId:staffId","pageType":"home","expireDate":7200}
```

3. Return the exact `value.message` URL.

Important:

- Do not return the Seal tenant URL such as `https://<tenant>.sealai.cc`; that is not the Hose authorization link.
- Do not manually assemble `thirdparty.html` with a global/OpenAPI token.
- `seal-home auth diagnose` proves this stage works but redacts the token, so it is not enough when the user needs the actual clickable Hose link.
- If the CLI later provides a dedicated command for this, prefer that command.
