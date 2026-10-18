<#
.SYNOPSIS
  One-shot local backend runner for Windows (the Windows equivalent of
  `make install db-local migrate dev`).

.DESCRIPTION
  1. Checks prerequisites (uv, PostgreSQL 16 + pgvector, Ollama)
  2. Ensures .env exists
  3. Installs Python dependencies (uv sync)
  4. Creates Postgres roles, extensions and the karkhana database (idempotent)
  5. Applies migrations and seeds demo users
  6. Starts Ollama and pulls the embedding model
  7. Starts the FastAPI server on :8080 (dev auth, auto-reload)

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\run-backend-windows.ps1
  powershell -ExecutionPolicy Bypass -File scripts\run-backend-windows.ps1 -Web
  powershell -ExecutionPolicy Bypass -File scripts\run-backend-windows.ps1 -SkipInstall -SkipDb
#>
param(
    [switch]$SkipInstall,   # skip `uv sync`
    [switch]$SkipDb,        # skip role/db creation and migrations
    [switch]$SkipOllama,    # don't start Ollama / pull models
    [switch]$Web,           # also start the React dev server (:5173) in a new window
    [int]$Port = 8080,
    [string]$PgSuperUser = "postgres",
    [string]$PgHost = "localhost",
    [int]$PgPort = 5432
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    $msg" -ForegroundColor Yellow }
function Die($msg)  { Write-Host "`nERROR: $msg" -ForegroundColor Red; exit 1 }

function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

# --- 1. Prerequisites -------------------------------------------------------
Step "Checking prerequisites"

if (-not (Has "uv")) {
    Warn "uv not found - installing it"
    powershell -ExecutionPolicy Bypass -c "irm https://astral.sh/uv/install.ps1 | iex"
    $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
    if (-not (Has "uv")) { Die "uv install failed. Install manually: winget install astral-sh.uv" }
}
Ok "uv: $(uv --version)"

if (-not (Has "psql")) {
    # The EDB installer doesn't add psql to PATH; look in the usual places.
    $pgBin = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue |
             Sort-Object FullName -Descending | Select-Object -First 1
    if ($pgBin) {
        $env:Path = "$($pgBin.DirectoryName);$env:Path"
    } else {
        Die "PostgreSQL not found. Install PostgreSQL 16: winget install PostgreSQL.PostgreSQL.16"
    }
}
Ok "psql: $(psql --version)"

if (-not $SkipOllama -and -not (Has "ollama")) {
    Warn "Ollama not found (needed for EMBED_PROVIDER=ollama). Install: winget install Ollama.Ollama"
    Warn "Continuing without it; pass -SkipOllama to hide this warning."
    $SkipOllama = $true
}

# --- 2. .env ----------------------------------------------------------------
Step "Checking .env"
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Warn "Created .env from .env.example - fill in your API keys, then re-run."
    } else {
        Warn "No .env found; running with defaults."
    }
} else {
    Ok ".env present"
}

# --- 3. Python dependencies -------------------------------------------------
if (-not $SkipInstall) {
    Step "Installing Python dependencies (uv sync)"
    uv sync
    if ($LASTEXITCODE -ne 0) { Die "uv sync failed" }
    Ok "Dependencies installed"
}

# --- 4. Database ------------------------------------------------------------
if (-not $SkipDb) {
    Step "Setting up Postgres (roles, extensions, database)"

    if (-not $env:PGPASSWORD) {
        $sec = Read-Host "Password for Postgres superuser '$PgSuperUser'" -AsSecureString
        $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
    }

    function Psql([string]$db, [string]$sql) {
        $out = psql -h $PgHost -p $PgPort -U $PgSuperUser -d $db -v ON_ERROR_STOP=1 -tAc $sql 2>&1
        if ($LASTEXITCODE -ne 0) { Die "psql failed on '$db': $out" }
        return ($out | Out-String).Trim()
    }

    Psql "postgres" "SELECT 1" | Out-Null
    Ok "Connected to Postgres at ${PgHost}:${PgPort}"

    $hasVector = Psql "postgres" "SELECT count(*) FROM pg_available_extensions WHERE name='vector'"
    if ($hasVector -ne "1") {
        Die @"
pgvector is not installed in this Postgres.
  Option A: In 'Application Stack Builder' (ships with PostgreSQL) install pgvector if listed.
  Option B: Build it - open 'x64 Native Tools Command Prompt for VS' as Administrator:
      set "PGROOT=C:\Program Files\PostgreSQL\16"
      git clone --branch v0.8.0 https://github.com/pgvector/pgvector.git
      cd pgvector
      nmake /F Makefile.win
      nmake /F Makefile.win install
Then re-run this script.
"@
    }

    Psql "postgres" @"
DO `$`$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='karkhana_owner') THEN
    CREATE ROLE karkhana_owner LOGIN CREATEDB PASSWORD 'karkhana_owner';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='karkhana_app') THEN
    CREATE ROLE karkhana_app LOGIN PASSWORD 'karkhana_app';
  END IF;
END `$`$;
"@ | Out-Null
    Ok "Roles karkhana_owner / karkhana_app ready"

    Psql "template1" "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto;" | Out-Null

    $dbExists = Psql "postgres" "SELECT count(*) FROM pg_database WHERE datname='karkhana'"
    if ($dbExists -ne "1") {
        Psql "postgres" "CREATE DATABASE karkhana OWNER karkhana_owner" | Out-Null
        Ok "Database karkhana created"
    } else {
        Ok "Database karkhana already exists"
    }
    Psql "karkhana" "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto;" | Out-Null

    Step "Applying migrations and seeding demo users"
    $env:DATABASE_URL = "postgresql+asyncpg://karkhana_owner:karkhana_owner@${PgHost}:${PgPort}/karkhana"
    uv run python -m app.scripts.migrate --seed
    $migrateExit = $LASTEXITCODE
    Remove-Item Env:DATABASE_URL       # the API itself connects as karkhana_app
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    if ($migrateExit -ne 0) { Die "Migrations failed" }
    Ok "Migrations applied"
}

# --- 5. Ollama --------------------------------------------------------------
if (-not $SkipOllama) {
    Step "Starting Ollama"
    $ollamaUp = $false
    try { Invoke-RestMethod "http://localhost:11434/api/tags" -TimeoutSec 2 | Out-Null; $ollamaUp = $true } catch {}
    if (-not $ollamaUp) {
        Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden
        for ($i = 0; $i -lt 20 -and -not $ollamaUp; $i++) {
            Start-Sleep -Milliseconds 500
            try { Invoke-RestMethod "http://localhost:11434/api/tags" -TimeoutSec 2 | Out-Null; $ollamaUp = $true } catch {}
        }
    }
    if ($ollamaUp) {
        Ok "Ollama running on :11434"
        $models = (ollama list) -join "`n"
        if ($models -notmatch "nomic-embed-text") {
            Warn "Pulling embedding model nomic-embed-text (one-time)"
            ollama pull nomic-embed-text
        }
        Ok "Embedding model ready"
    } else {
        Warn "Ollama didn't start; embeddings will fail until it's running."
    }
}

# --- 6. Frontend (optional) -------------------------------------------------
if ($Web) {
    Step "Starting web dev server in a new window (:5173)"
    if (-not (Has "npm")) { Warn "npm not found - install Node 18+: winget install OpenJS.NodeJS.LTS" }
    else {
        $webCmd = "Set-Location '$RepoRoot\web'; if (-not (Test-Path node_modules)) { npm ci }; npm run dev"
        Start-Process powershell -ArgumentList "-NoExit", "-Command", $webCmd
        Ok "Web: http://localhost:5173"
    }
}

# --- 7. API -----------------------------------------------------------------
Step "Starting API on http://localhost:$Port  (docs: http://localhost:$Port/docs)"
Write-Host "    Press Ctrl+C to stop.`n" -ForegroundColor DarkGray
$env:AUTH_MODE = "dev"
uv run uvicorn app.fast_api_app:app --port $Port --reload
