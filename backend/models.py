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
    note: str = ""
    accountId: Optional[str] = None


class TradeOut(BaseModel):
    id: str
    date: str
    type: str
    shares: float
    price: float
    fee: float
    sigRef: str
    note: str
    accountId: Optional[str]


# ── Accounts ─────────────────────────────────────────
class AccountIn(BaseModel):
    id: str
    name: str
    balance: float = 0
    interestRate: float = 0
    note: str = ""


class AccountPatch(BaseModel):
    name: Optional[str] = None
    balance: Optional[float] = None
    interestRate: Optional[float] = None
    note: Optional[str] = None


class AccountOut(BaseModel):
    id: str
    name: str
    balance: float
    interestRate: float
    note: str


# ── Tracked Stocks ───────────────────────────────────
class TrackedIn(BaseModel):
    code: str
    status: str = "tracking"
    thesis: str = ""
    memo: str = ""
    stopLoss: str = ""
    takeProfit: str = ""
    addedAt: int


class TrackedPatch(BaseModel):
    status: Optional[str] = None
    thesis: Optional[str] = None
    memo: Optional[str] = None
    stopLoss: Optional[str] = None
    takeProfit: Optional[str] = None


class TrackedOut(BaseModel):
    code: str
    status: str
    thesis: str
    memo: str
    stopLoss: str
    takeProfit: str
    addedAt: int


# ── Brokers ──────────────────────────────────────────
class BrokerIn(BaseModel):
    id: str
    name: str
    discount: float = 0.6
    minFee: int = 20
    rounding: str = "floor"


class BrokerOut(BaseModel):
    id: str
    name: str
    discount: float
    minFee: int
    rounding: str


# ── Sources ──────────────────────────────────────────
class SourceIn(BaseModel):
    name: str


# ── Trade Markets ────────────────────────────────────
class MarketIn(BaseModel):
    market: str


# ── Liabilities ──────────────────────────────────────
class LiabilityIn(BaseModel):
    id: str
    name: str
    type: str = "其他"
    amount: float = 0
    reminderEnabled: bool = False
    reminderDate: Optional[str] = None
    note: str = ""


class LiabilityPatch(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    amount: Optional[float] = None
    reminderEnabled: Optional[bool] = None
    reminderDate: Optional[str] = None
    note: Optional[str] = None


class LiabilityOut(BaseModel):
    id: str
    name: str
    type: str
    amount: float
    reminderEnabled: bool
    reminderDate: Optional[str]
    note: str
