# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WatchList is a full-stack investment tracking application for Taiwan stock market research. The backend is Python FastAPI serving a compiled Angular frontend as static files. Data is stored in SQLite with raw SQL (no ORM).

## Commands

### Backend
```bash
python run.py                    # Start FastAPI on http://localhost:8000
pip install -r requirements.txt  # Install Python dependencies
```

### Frontend (development)
```bash
cd frontend
pnpm install
pnpm ng serve                    # Dev server on http://localhost:4200 (proxies /api to :8000)
pnpm ng build                    # Production build → backend/static/browser/
pnpm ng test                     # Run unit tests via Vitest
```

### Data migration (one-time)
```bash
python migrate_localstorage.py export.json  # Import legacy localStorage data into SQLite
```

## Architecture

### Backend (`backend/`)
- **`main.py`** — FastAPI app, CORS config, mounts all routers under `/api`, serves compiled Angular from `static/browser/`
- **`database.py`** — SQLite initialization (WAL mode, FK constraints enabled), DDL, connection context manager
- **`models.py`** — Pydantic schemas; uses `In`/`Out`/`Patch` naming convention per model for create/read/update
- **`finmind.py`** — FinMind API client for Taiwan stock prices (requires JWT token configured in this file)
- **`routers/`** — Route groups: `notes.py`, `signals.py`, `trades.py`, `stocks.py`, `sources.py`

### Data Model
Hierarchical note structure: **Note → Row → Entry**. Entries track individual stocks with a status (`holding`/`tracking`/`watching`), thesis, and memo fields. Signals and Trades are linked to stock codes independently of the notes hierarchy.

### Frontend (`frontend/src/app/`)
- **`services/app-state.service.ts`** — Single source of truth; uses Angular Signals for reactive global state
- **`services/api.service.ts`** — Wraps all HTTP calls to the backend REST API
- **`models/types.ts`** — Shared TypeScript interfaces matching backend Pydantic models
- **`components/`** — Standalone components (no NgModules); main views are `notes-view`, `stock-index`, `signals-view`

### Key conventions
- All components are standalone Angular 21 components
- Use `firstValueFrom()` (not `.subscribe()`) when converting Observables to Promises in services
- Database writes use context managers for automatic rollback on error
- The `fmtD` utility in `utils.ts` handles timezone-aware date formatting throughout the frontend
