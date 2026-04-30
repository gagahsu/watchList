from __future__ import annotations
from typing import Optional
from pydantic import BaseModel


# ── Entries ──────────────────────────────────────────
class EntryIn(BaseModel):
    id: str
    code: str
    name: str = ""
    status: str = "tracking"
    thesis: str = ""
    memo: str = ""


class EntryPatch(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    status: Optional[str] = None
    thesis: Optional[str] = None
    memo: Optional[str] = None


class EntryOut(BaseModel):
    id: str
    code: str
    name: str
    status: str
    thesis: str
    memo: str


# ── Rows ─────────────────────────────────────────────
class RowIn(BaseModel):
    id: str
    category: str = ""
    entries: list[EntryIn] = []


class RowPatch(BaseModel):
    category: Optional[str] = None


class RowOut(BaseModel):
    id: str
    category: str
    entries: list[EntryOut]


# ── Notes ────────────────────────────────────────────
class NoteIn(BaseModel):
    id: str
    title: str = ""
    description: str = ""
    createdAt: int
    rows: list[RowIn] = []


class NotePatch(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None


class NoteOut(BaseModel):
    id: str
    title: str
    description: str
    createdAt: int
    rows: list[RowOut]


# ── Signals ──────────────────────────────────────────
class SignalIn(BaseModel):
    id: str
    date: int
    direction: str
    source: str = ""
    condition: str = ""
    price: str = ""
    status: str = "active"
    invalidReason: str = ""


class SignalPatch(BaseModel):
    status: Optional[str] = None
    invalidReason: Optional[str] = None
    direction: Optional[str] = None
    source: Optional[str] = None
    condition: Optional[str] = None
    price: Optional[str] = None


class SignalOut(BaseModel):
    id: str
    date: int
    direction: str
    source: str
    condition: str
    price: str
    status: str
    invalidReason: str


# ── Trades ───────────────────────────────────────────
class TradeIn(BaseModel):
    id: str
    date: str
    type: str
    shares: float
    price: float
    fee: float = 0
    sigRef: str = ""


class TradeOut(BaseModel):
    id: str
    date: str
    type: str
    shares: float
    price: float
    fee: float
    sigRef: str


# ── Tracked Stocks ───────────────────────────────────
class TrackedIn(BaseModel):
    code: str
    status: str = "tracking"
    thesis: str = ""
    memo: str = ""
    addedAt: int


class TrackedPatch(BaseModel):
    status: Optional[str] = None
    thesis: Optional[str] = None
    memo: Optional[str] = None


class TrackedOut(BaseModel):
    code: str
    status: str
    thesis: str
    memo: str
    addedAt: int


# ── Sources ──────────────────────────────────────────
class SourceIn(BaseModel):
    name: str


# ── Trade Markets ────────────────────────────────────
class MarketIn(BaseModel):
    market: str
