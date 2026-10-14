#!/usr/bin/env bash
# One-time, idempotent GCP setup for Software Karkhana. Safe to re-run.
#
#   PROJECT_ID=karkhana-hack-123 BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX \
#   GITHUB_TOKEN=github_pat_... ./infra/bootstrap.sh
#
# Creates: project (if missing), billing link, budget alert, APIs, Artifact
# Registry, three least-privilege service accounts, Cloud SQL (Postgres 16 +
# IAM auth), secrets, artifacts bucket. Firebase Auth has 3 console clicks,
# printed at the end.
set -euo pipefail

: "${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-us-central1}"
SQL_INSTANCE="${SQL_INSTANCE:-karkhana-db}"
BUDGET_AMOUNT="${BUDGET_AMOUNT:-100}"
log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

log "Project"
if ! gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud projects create "$PROJECT_ID" --name="Software Karkhana"
fi
gcloud config set project "$PROJECT_ID" >/dev/null
if [[ -n "${BILLING_ACCOUNT:-}" ]]; then
  gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT" >/dev/null
  gcloud services enable billingbudgets.googleapis.com
  gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" --format='value(displayName)' | grep -q "^karkhana-budget$" || \
    gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" --display-name=karkhana-budget \
      --budget-amount="${BUDGET_AMOUNT}USD" --filter-projects="projects/$PROJECT_ID" \
      --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
fi
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

log "APIs"
gcloud services enable \
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  sqladmin.googleapis.com aiplatform.googleapis.com secretmanager.googleapis.com \
  storage.googleapis.com logging.googleapis.com iam.googleapis.com \
  firebase.googleapis.com identitytoolkit.googleapis.com cloudresourcemanager.googleapis.com

log "Artifact Registry"
gcloud artifacts repositories describe karkhana --location="$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create karkhana --repository-format=docker --location="$REGION"

log "Service accounts (one per role, least privilege)"
for sa in karkhana-run karkhana-worker karkhana-migrate; do
  gcloud iam service-accounts describe "$sa@$PROJECT_ID.iam.gserviceaccount.com" >/dev/null 2>&1 || \
    gcloud iam service-accounts create "$sa" --display-name="$sa"
done
RUN_SA="karkhana-run@$PROJECT_ID.iam.gserviceaccount.com"
WORKER_SA="karkhana-worker@$PROJECT_ID.iam.gserviceaccount.com"
MIGRATE_SA="karkhana-migrate@$PROJECT_ID.iam.gserviceaccount.com"
BUILD_SA="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"

grant() { gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$1" --role="$2" --condition=None >/dev/null; }
# API: Cloud SQL via IAM, Gemini, start worker Job executions, logs.
for r in roles/cloudsql.client roles/cloudsql.instanceUser roles/aiplatform.user roles/run.developer \
         roles/logging.logWriter roles/firebaseauth.viewer; do grant "$RUN_SA" "$r"; done
# Worker: Gemini, write artifacts, logs. No database access at all.
for r in roles/aiplatform.user roles/logging.logWriter; do grant "$WORKER_SA" "$r"; done
# Migrate: Cloud SQL connection only.
for r in roles/cloudsql.client roles/logging.logWriter; do grant "$MIGRATE_SA" "$r"; done
# The API may launch the worker Job as the worker identity.
gcloud iam service-accounts add-iam-policy-binding "$WORKER_SA" --member="serviceAccount:$RUN_SA" \
  --role=roles/iam.serviceAccountUser >/dev/null
# Cloud Build deploys as the default compute SA.
for r in roles/run.admin roles/iam.serviceAccountUser roles/artifactregistry.writer \
         roles/secretmanager.secretAccessor roles/logging.logWriter; do grant "$BUILD_SA" "$r"; done

log "Cloud SQL (Postgres 16, IAM database auth) - takes ~10 minutes the first time"
if ! gcloud sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1; then
  gcloud sql instances create "$SQL_INSTANCE" --database-version=POSTGRES_16 --edition=ENTERPRISE \
    --tier=db-g1-small --region="$REGION" --storage-size=10GB --storage-auto-increase \
    --database-flags=cloudsql.iam_authentication=on --backup-start-time=20:00
fi
gcloud sql databases describe karkhana --instance="$SQL_INSTANCE" >/dev/null 2>&1 || \
  gcloud sql databases create karkhana --instance="$SQL_INSTANCE"
# Schema owner: built-in user, password only in Secret Manager.
if ! gcloud secrets describe db-owner-password >/dev/null 2>&1; then
  OWNER_PW=$(openssl rand -base64 24 | tr -d '/+=')
  printf '%s' "$OWNER_PW" | gcloud secrets create db-owner-password --data-file=-
  gcloud sql users create karkhana_owner --instance="$SQL_INSTANCE" --password="$OWNER_PW"
fi
# App: IAM user for the run SA (no password exists).
gcloud sql users list --instance="$SQL_INSTANCE" --format='value(name)' | grep -q "^karkhana-run@$PROJECT_ID.iam$" || \
  gcloud sql users create "karkhana-run@$PROJECT_ID.iam" --instance="$SQL_INSTANCE" --type=cloud_iam_service_account

log "Secrets"
make_secret() {  # name value
  gcloud secrets describe "$1" >/dev/null 2>&1 || gcloud secrets create "$1" --replication-policy=automatic >/dev/null
  printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=- >/dev/null
}
gcloud secrets describe run-hmac-secret >/dev/null 2>&1 || make_secret run-hmac-secret "$(openssl rand -hex 32)"
if [[ -n "${GITHUB_TOKEN:-}" ]]; then make_secret github-token "$GITHUB_TOKEN"
else gcloud secrets describe github-token >/dev/null 2>&1 || make_secret github-token "unset"; fi
if [[ -n "${FIREBASE_WEB_API_KEY:-}" ]]; then make_secret firebase-web-api-key "$FIREBASE_WEB_API_KEY"; fi
for s in db-owner-password; do
  gcloud secrets add-iam-policy-binding "$s" --member="serviceAccount:$MIGRATE_SA" --role=roles/secretmanager.secretAccessor >/dev/null
done
for s in run-hmac-secret github-token; do
  gcloud secrets add-iam-policy-binding "$s" --member="serviceAccount:$RUN_SA" --role=roles/secretmanager.secretAccessor >/dev/null
done
# The worker gets no secrets at all: it runs untrusted repository code. If an
# earlier bootstrap granted it the GitHub token, remove that grant.
gcloud secrets remove-iam-policy-binding github-token --member="serviceAccount:$WORKER_SA" \
  --role=roles/secretmanager.secretAccessor >/dev/null 2>&1 || true

log "Artifacts bucket"
BUCKET="gs://$PROJECT_ID-karkhana-artifacts"
gcloud storage buckets describe "$BUCKET" >/dev/null 2>&1 || \
  gcloud storage buckets create "$BUCKET" --location="$REGION" --uniform-bucket-level-access
gcloud storage buckets add-iam-policy-binding "$BUCKET" --member="serviceAccount:$WORKER_SA" --role=roles/storage.objectCreator >/dev/null

cat <<EOF

Done. Remaining manual steps (about 5 minutes):
  1. Firebase console -> Add project -> pick "$PROJECT_ID".
     Authentication -> Sign-in method -> enable Google and Email/Password.
     Settings -> Authorized domains -> add karkhana-$PROJECT_NUMBER.$REGION.run.app
  2. Project settings -> Web app -> copy apiKey, then:
       FIREBASE_WEB_API_KEY=<apiKey> PROJECT_ID=$PROJECT_ID ./infra/bootstrap.sh
  3. Check models:   GOOGLE_CLOUD_PROJECT=$PROJECT_ID uv run python -m app.scripts.check_models
  4. Deploy:         gcloud builds submit --config cloudbuild.yaml --substitutions=_GITHUB_REPO=<owner>/invoicekit
  5. Seed users:     see docs/PHASE0.md ("Seed users on Cloud SQL")
EOF
