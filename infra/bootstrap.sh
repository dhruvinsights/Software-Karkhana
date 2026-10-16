#!/usr/bin/env bash
# One-time, idempotent GCP foundation for Software Karkhana. Safe to re-run.
#
#   PROJECT_ID=karkhana-hack-123 BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX \
#   GITHUB_TOKEN=github_pat_... ./infra/bootstrap.sh
#
# This sets up the foundation only. It never builds or deploys the app: that is
# `make deploy` (cloudbuild.yaml), which you run after this and on every change.
# Re-run this script only when the foundation changes: a new secret value
# (GitHub token, Firebase key), a new role or API, or a fresh project.
#
# Creates: project (if missing), billing link, budget alert, APIs, Artifact
# Registry, four least-privilege service accounts (API, worker, migrate, build),
# Cloud SQL (Postgres 16, IAM auth, deletion protection, TLS only), secrets,
# an artifacts bucket and a build-source bucket. Firebase Auth needs 3 console
# clicks, printed at the end.
set -euo pipefail

: "${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-us-central1}"
SQL_INSTANCE="${SQL_INSTANCE:-karkhana-db}"
SQL_TIER="${SQL_TIER:-db-g1-small}"
BUDGET_AMOUNT="${BUDGET_AMOUNT:-100}"
log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
# Exact-line match on captured output. Avoids `cmd | grep -q`, which under
# pipefail can fail with SIGPIPE and make an existing resource look missing.
has_line() { grep -qxF -- "$1" <<<"$2"; }
# New service accounts take a few seconds to become visible to IAM.
retry() { local i; for i in 1 2 3 4 5 6; do "$@" && return 0; sleep $((i * 3)); done; return 1; }

log "Project"
if ! gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud projects create "$PROJECT_ID" --name="Software Karkhana"
fi
gcloud config set project "$PROJECT_ID" >/dev/null
if [[ -n "${BILLING_ACCOUNT:-}" ]]; then
  gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT" >/dev/null
  gcloud services enable billingbudgets.googleapis.com
  budgets=$(gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" --format='value(displayName)')
  if ! has_line karkhana-budget "$budgets"; then
    gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" --display-name=karkhana-budget \
      --budget-amount="${BUDGET_AMOUNT}USD" --filter-projects="projects/$PROJECT_ID" \
      --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
  fi
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
for sa in karkhana-run karkhana-worker karkhana-migrate karkhana-build; do
  gcloud iam service-accounts describe "$sa@$PROJECT_ID.iam.gserviceaccount.com" >/dev/null 2>&1 || \
    gcloud iam service-accounts create "$sa" --display-name="$sa"
done
RUN_SA="karkhana-run@$PROJECT_ID.iam.gserviceaccount.com"
WORKER_SA="karkhana-worker@$PROJECT_ID.iam.gserviceaccount.com"
MIGRATE_SA="karkhana-migrate@$PROJECT_ID.iam.gserviceaccount.com"
# Cloud Build runs as its own identity, not the default compute SA (which may
# carry Editor). `make deploy` passes it with --service-account.
BUILD_SA="karkhana-build@$PROJECT_ID.iam.gserviceaccount.com"

grant() { retry gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$1" --role="$2" --condition=None >/dev/null; }
act_as() { retry gcloud iam service-accounts add-iam-policy-binding "$1" --member="serviceAccount:$2" --role=roles/iam.serviceAccountUser >/dev/null; }
# API: Cloud SQL via IAM, Gemini, start worker Job executions, logs.
for r in roles/cloudsql.client roles/cloudsql.instanceUser roles/aiplatform.user roles/run.developer \
         roles/logging.logWriter roles/firebaseauth.viewer; do grant "$RUN_SA" "$r"; done
# Worker: Gemini and logs. No database access, no secrets.
for r in roles/aiplatform.user roles/logging.logWriter; do grant "$WORKER_SA" "$r"; done
# Migrate: Cloud SQL connection only.
for r in roles/cloudsql.client roles/logging.logWriter; do grant "$MIGRATE_SA" "$r"; done
# Build: deploy Cloud Run, write logs. Everything else is granted on the
# specific resource below (repo, buckets, secret, runtime SAs).
for r in roles/run.admin roles/logging.logWriter; do grant "$BUILD_SA" "$r"; done
# The API may launch the worker Job as the worker identity.
act_as "$WORKER_SA" "$RUN_SA"
# The build may deploy services and jobs that run as these three identities.
for sa in "$RUN_SA" "$WORKER_SA" "$MIGRATE_SA"; do act_as "$sa" "$BUILD_SA"; done
retry gcloud artifacts repositories add-iam-policy-binding karkhana --location="$REGION" \
  --member="serviceAccount:$BUILD_SA" --role=roles/artifactregistry.writer >/dev/null

log "Cloud SQL (Postgres 16, IAM database auth) - takes ~10 minutes the first time"
if ! gcloud sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1; then
  # Public IP with no authorized networks: only the Cloud SQL connector (IAM +
  # mTLS) can reach it. db-g1-small allows ~50 connections; cloudbuild.yaml
  # caps the API at 3 instances x 10 pooled connections to stay under that.
  gcloud sql instances create "$SQL_INSTANCE" --database-version=POSTGRES_16 --edition=ENTERPRISE \
    --tier="$SQL_TIER" --region="$REGION" --storage-size=10GB --storage-auto-increase \
    --database-flags=cloudsql.iam_authentication=on --backup-start-time=20:00 \
    --ssl-mode=ENCRYPTED_ONLY --deletion-protection
fi
if [[ "$(gcloud sql instances describe "$SQL_INSTANCE" --format='value(settings.deletionProtectionEnabled)')" != "True" ]]; then
  gcloud sql instances patch "$SQL_INSTANCE" --deletion-protection --quiet
fi
gcloud sql databases describe karkhana --instance="$SQL_INSTANCE" >/dev/null 2>&1 || \
  gcloud sql databases create karkhana --instance="$SQL_INSTANCE"
# Schema owner: built-in user (gets cloudsqlsuperuser, needed for CREATE
# EXTENSION vector). Its password lives only in Secret Manager. The secret and
# the user are checked separately so a half-finished run heals on re-run.
if ! gcloud secrets describe db-owner-password >/dev/null 2>&1; then
  openssl rand -base64 24 | tr -d '/+=\n' | \
    gcloud secrets create db-owner-password --replication-policy=automatic --data-file=- >/dev/null
fi
sql_users=$(gcloud sql users list --instance="$SQL_INSTANCE" --format='value(name)')
if ! has_line karkhana_owner "$sql_users"; then
  gcloud sql users create karkhana_owner --instance="$SQL_INSTANCE" \
    --password="$(gcloud secrets versions access latest --secret=db-owner-password)"
fi
# App: IAM user for the run SA (no password exists).
if ! has_line "karkhana-run@$PROJECT_ID.iam" "$sql_users"; then
  gcloud sql users create "karkhana-run@$PROJECT_ID.iam" --instance="$SQL_INSTANCE" --type=cloud_iam_service_account
fi

log "Secrets"
ensure_secret() { gcloud secrets describe "$1" >/dev/null 2>&1 || gcloud secrets create "$1" --replication-policy=automatic >/dev/null; }
make_secret() {  # name value: adds a new version
  ensure_secret "$1"
  printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=- >/dev/null
}
secret_access() { retry gcloud secrets add-iam-policy-binding "$1" --member="serviceAccount:$2" --role=roles/secretmanager.secretAccessor >/dev/null; }
gcloud secrets describe run-hmac-secret >/dev/null 2>&1 || make_secret run-hmac-secret "$(openssl rand -hex 32)"
gcloud secrets describe session-jwt-secret >/dev/null 2>&1 || make_secret session-jwt-secret "$(openssl rand -hex 32)"
# Fernet key(s) that encrypt stored GitHub OAuth tokens (app/crypto.py): 32
# random bytes, url-safe base64. Comma-separated; the first encrypts, all
# decrypt. To rotate, add a version "NEW,OLD", deploy, run
# app.scripts.reencrypt_tokens, then add a version "NEW". Created once only.
# TODO(kms): wrap this data key with Cloud KMS (see app/crypto.py).
gcloud secrets describe token-encryption-keys >/dev/null 2>&1 || \
  make_secret token-encryption-keys "$(openssl rand -base64 32 | tr '+/' '-_')"
if [[ -n "${GITHUB_TOKEN:-}" ]]; then make_secret github-token "$GITHUB_TOKEN"
else gcloud secrets describe github-token >/dev/null 2>&1 || make_secret github-token "unset"; fi
# The Firebase web key is public by design (it ships to the browser); it is in
# Secret Manager only so the build can read it. The container exists from the
# start so the build's grant works before the key is added.
ensure_secret firebase-web-api-key
if [[ -n "${FIREBASE_WEB_API_KEY:-}" ]]; then make_secret firebase-web-api-key "$FIREBASE_WEB_API_KEY"; fi
secret_access db-owner-password "$MIGRATE_SA"
for s in run-hmac-secret session-jwt-secret github-token token-encryption-keys; do secret_access "$s" "$RUN_SA"; done
secret_access firebase-web-api-key "$BUILD_SA"
# The worker gets no secrets at all: it runs untrusted repository code. If an
# earlier bootstrap granted it the GitHub token, remove that grant.
gcloud secrets remove-iam-policy-binding github-token --member="serviceAccount:$WORKER_SA" \
  --role=roles/secretmanager.secretAccessor >/dev/null 2>&1 || true

log "Buckets"
LIFECYCLE=$(mktemp)
trap 'rm -f "$LIFECYCLE"' EXIT
ensure_bucket() {  # bucket days-to-keep
  gcloud storage buckets describe "$1" >/dev/null 2>&1 || \
    gcloud storage buckets create "$1" --location="$REGION" --uniform-bucket-level-access \
      --public-access-prevention
  printf '{"rule":[{"action":{"type":"Delete"},"condition":{"age":%d}}]}' "$2" >"$LIFECYCLE"
  gcloud storage buckets update "$1" --public-access-prevention --lifecycle-file="$LIFECYCLE" >/dev/null
}
# Run artifacts (patch + test log per run), kept 30 days.
ARTIFACTS="gs://$PROJECT_ID-karkhana-artifacts"
ensure_bucket "$ARTIFACTS" 30
retry gcloud storage buckets add-iam-policy-binding "$ARTIFACTS" --member="serviceAccount:$WORKER_SA" \
  --role=roles/storage.objectCreator >/dev/null
# Source tarballs that `make deploy` uploads for Cloud Build, kept 7 days.
BUILD_SRC="gs://$PROJECT_ID-karkhana-build"
ensure_bucket "$BUILD_SRC" 7
retry gcloud storage buckets add-iam-policy-binding "$BUILD_SRC" --member="serviceAccount:$BUILD_SA" \
  --role=roles/storage.objectViewer >/dev/null

cat <<EOF

Done. The foundation is ready. Remaining steps (about 5 minutes + deploy):
  1. Firebase console -> Add project -> pick "$PROJECT_ID".
     Authentication -> Sign-in method -> enable Google and Email/Password.
     Settings -> Authorized domains -> add karkhana-$PROJECT_NUMBER.$REGION.run.app
  2. Project settings -> Web app -> copy apiKey, then:
       FIREBASE_WEB_API_KEY=<apiKey> PROJECT_ID=$PROJECT_ID ./infra/bootstrap.sh
  3. Check models:   GOOGLE_CLOUD_PROJECT=$PROJECT_ID make check-models
  4. Deploy + seed:  make deploy PROJECT_ID=$PROJECT_ID GITHUB_REPO=<owner>/invoicekit \\
                       SEED_USERS="you@gmail.com:pm,teammate@gmail.com:director"
     (re-run make deploy for every code change; see docs/GO_LIVE.md)

Optional cleanup: earlier versions of this script granted deploy roles to the
default compute SA ($PROJECT_NUMBER-compute@developer.gserviceaccount.com).
Builds now run as $BUILD_SA, so those grants can be removed.
EOF
