# Search Console access for the SEO agent (stage 2.1)

Read-only. Two ways; the keyless one is preferred (D-067). Both are free and need no billing.

| | A. Keyless (Workload Identity Federation) — preferred | B. Service account JSON key — fallback |
|---|---|---|
| Long-lived secret | none | the key, valid until deleted |
| If something leaks | a token that is read-only and expires in 15 minutes | the key reads Search Console data until revoked |
| Who can use it | only the `seo-agent.yml` workflow of `OlviaHome/pafospharmacy` on `main`, environment `seo-readonly` | anyone holding the file |
| Blocked by Google's "Disable service account key creation" policy | no | yes |
| Rotation | nothing to rotate | manual |
| Setup | Cloud Shell: one copy-paste block, then 2 GitHub variables | ~10 console clicks, then 1 GitHub secret |
| Runs outside GitHub Actions (laptop, other CI) | no | yes |
| Next client site | 1 more provider + 1 binding in the same pool | 1 more key |

In both cases the service account is added to Search Console as a **Restricted** user and asks only for
`https://www.googleapis.com/auth/webmasters.readonly`.

## A. Keyless (preferred)

1. Google Cloud: create a project (no organization, no billing needed), e.g. `oa-seo-agent`.
   Note its **Project ID** (it may get a suffix, e.g. `oa-seo-agent-482311`).
2. Open **Cloud Shell** (the `>_` icon, top right) and paste, replacing the Project ID:

```bash
PROJECT_ID="oa-seo-agent-REPLACE"
REPO_ID="1358170236"          # OlviaHome/pafospharmacy (numeric, cannot be reused by another repo)
OWNER_ID="204877375"          # OlviaHome (numeric)
SA="seo-reader-healthguide"

gcloud config set project "$PROJECT_ID"
gcloud services enable searchconsole.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com
gcloud iam service-accounts create "$SA" --display-name="SEO reader, HealthGuide.cy (read-only)"
gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions (OA Studio)"
gcloud iam workload-identity-pools providers create-oidc pafospharmacy \
  --location=global --workload-identity-pool=github \
  --display-name="pafospharmacy main" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.workflow_ref=assertion.workflow_ref,attribute.environment=assertion.environment" \
  --attribute-condition="assertion.repository_owner_id == '${OWNER_ID}' && assertion.repository_id == '${REPO_ID}' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == 'OlviaHome/pafospharmacy/.github/workflows/seo-agent.yml@refs/heads/main' && assertion.environment == 'seo-readonly'"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding "${SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository_id/${REPO_ID}"
echo "GCP_WIF_PROVIDER=projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/providers/pafospharmacy"
echo "GSC_SERVICE_ACCOUNT=${SA}@${PROJECT_ID}.iam.gserviceaccount.com"
```

   The service account gets **no** project roles. The last two lines print the two values for step 4.
   Google issues a token only when **all** of these hold: owner and repository by numeric ID, branch
   `main`, the workflow file `.github/workflows/seo-agent.yml` on `main`, and environment `seo-readonly`.
   Any other workflow, branch, fork or repository is refused.
3. Search Console → healthguide.cy → Settings → Users and permissions → Add user → the
   `GSC_SERVICE_ACCOUNT` email → permission **Restricted**.
4. GitHub → repository Settings → Environments → `seo-readonly` (deployment branches: `main` only)
   → **Environment variables** (not secrets — neither value is secret): `GCP_WIF_PROVIDER`,
   `GSC_SERVICE_ACCOUNT`.
5. Tell the agent the property type: Domain (`sc-domain:healthguide.cy`) or URL prefix
   (`https://healthguide.cy/`).

## Checks done before connecting (2026-11-25)

- **One workflow only.** GitHub's OIDC token carries `workflow_ref`
  (`owner/repo/.github/workflows/<file>@<ref>`); the provider condition pins it to `seo-agent.yml`
  on `main`. Note: `main` has no branch protection today, so anyone who can push to `main` could
  change that file. A free branch rule (PRs required) closes this — owner decision.
- **Restricted user is enough** for the three calls: Performance data (Search Analytics) is visible
  to restricted users; URL Inspection is "fetch only" for them, which is exactly the read the API
  does (no "request indexing"); the Sitemaps report is visible, only *submitting* needs Full.
  The first real run confirms each API separately (`gsc.api.search-analytics`,
  `gsc.api.url-inspection`, `gsc.api.sitemaps`). If one answers 403, first check the property
  format (`sc-domain:` vs URL prefix with trailing `/`), then decide; nothing is raised automatically.
- **Nothing private in public logs.** The job prints one line built only from fixed words, counts,
  verdicts and per-API PASS/BLOCKER (`publicLogLine`); crashes print the error class only
  (`publicErrorLine`); errors never contain the token or key; no artifacts are uploaded; the auth
  step writes no credentials file. Do not enable GitHub "debug logging" for this workflow.
- **No billing.** Search Console API and IAM (including Workload Identity Federation) are free;
  billing is needed only for APIs that charge. Do not create a billing account for this project;
  if the console or Cloud Shell asks for one, stop and tell the agent.

## B. JSON key (fallback, only if A is not possible)

1–3 as in A, but create the service account in the console and skip the pool/provider commands.
Then service account → Keys → Add key → JSON; put the whole file into the `seo-readonly`
environment **secret** `GSC_SERVICE_ACCOUNT_JSON`; delete the file. Do not set `GCP_WIF_PROVIDER`:
the workflow uses the key only when keyless auth is not configured.

## Check

Actions → "SEO agent (manual)" → Run workflow → job `stats-indexing`. The public log shows only
`<run id>: <status> (PASS …, WARN …, FAIL …, BLOCKER …)`. `blocked` with `gsc.access` means the
credentials or the Search Console user are not in place yet.

## Revoke

Keyless: delete the provider (`gcloud iam workload-identity-pools providers delete pafospharmacy
--location=global --workload-identity-pool=github`) or remove the Search Console user.
Key: delete the key in the service account and the GitHub secret.
