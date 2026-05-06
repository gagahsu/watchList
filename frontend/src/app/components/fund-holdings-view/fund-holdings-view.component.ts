import { Component, computed, signal } from '@angular/core';
import { AppStateService } from '../../services/app-state.service';
import { ApiService } from '../../services/api.service';
import { FundHolding, FundSchedule } from '../../models/types';
import { uid } from '../../utils';

@Component({
  selector: 'app-fund-holdings-view',
  template: `
<!-- Summary bar -->
@if (state.funds().length > 0) {
  <div class="fv-summary-bar">
    <div class="fv-summary-item">
      <span class="fv-summary-label">總投入成本</span>
      <span class="fv-summary-value">{{ fmtNT(totalCost()) }}</span>
    </div>
    <div class="fv-summary-item">
      <span class="fv-summary-label">總市值</span>
      <span class="fv-summary-value">{{ fmtNT(totalMV()) }}</span>
    </div>
    <div class="fv-summary-item">
      <span class="fv-summary-label">未實現損益</span>
      <span class="fv-summary-value" [class.fv-pos]="totalPnL() >= 0" [class.fv-neg]="totalPnL() < 0">
        {{ totalPnL() >= 0 ? '+' : '' }}{{ fmtNT(totalPnL()) }}
      </span>
    </div>
    <div class="fv-summary-item">
      <span class="fv-summary-label">報酬率</span>
      <span class="fv-summary-value" [class.fv-pos]="totalPnL() >= 0" [class.fv-neg]="totalPnL() < 0">
        {{ totalCost() > 0 ? (totalPnL() >= 0 ? '+' : '') + (totalPnL() / totalCost() * 100).toFixed(2) + '%' : '—' }}
      </span>
    </div>
    @if (totalMonthly() > 0) {
      <div class="fv-summary-item">
        <span class="fv-summary-label">每月定期定額</span>
        <span class="fv-summary-value" style="color:var(--gold)">{{ fmtNT(totalMonthly()) }}</span>
      </div>
    }
  </div>
}

@if (state.funds().length === 0) {
  <div class="empty-state">
    <div class="empty-icon" style="font-size:36px;opacity:.4">🏦</div>
    <div class="empty-title">尚無基金持倉</div>
    <div class="empty-sub">新增基金，追蹤投入成本與目前市值</div>
    <button class="empty-btn" (click)="openNew()">＋ 新增基金</button>
  </div>
} @else {
  <div class="index-toolbar">
    <span style="font-size:12px;color:var(--text-muted)">{{ state.funds().length }} 筆 · 點擊列編輯</span>
    <button class="idx-add-btn" (click)="openNew()">＋ 新增基金</button>
  </div>

  <table class="index-table">
    <thead><tr>
      <th>基金名稱</th>
      <th style="text-align:right">投入成本</th>
      <th style="text-align:right">目前市值</th>
      <th style="text-align:right">損益</th>
      <th style="text-align:right">報酬率</th>
      <th style="text-align:right">每月扣款</th>
      <th>扣款帳戶</th>
      <th>備註</th>
    </tr></thead>
    <tbody>
      @for (f of state.funds(); track f.id) {
        @let pnl = f.marketValue - f.cost;
        @let pct = f.cost > 0 ? pnl / f.cost * 100 : null;
        @let monthly = f.schedules.reduce((s, sc) => s + sc.amount, 0);
        @let acct = f.accountId ? state.accounts().find(a => a.id === f.accountId) : null;
        <tr (click)="openEdit(f)">
          <td>
            <div style="font-weight:600">{{ f.name }}</div>
            @if (f.schedules.length > 0) {
              <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
                定期定額
                @for (s of f.schedules; track s.id) {
                  <span style="margin-right:6px">每月{{ s.dayOfMonth }}日</span>
                }
              </div>
            }
          </td>
          <td class="fv-num">{{ fmtNT(f.cost) }}</td>
          <td class="fv-num">{{ fmtNT(f.marketValue) }}</td>
          <td class="fv-num" [class.fv-pos]="pnl >= 0" [class.fv-neg]="pnl < 0">
            {{ (pnl >= 0 ? '+' : '') + fmtNT(pnl) }}
          </td>
          <td class="fv-num" [class.fv-pos]="pnl >= 0" [class.fv-neg]="pnl < 0">
            {{ pct != null ? (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%' : '—' }}
          </td>
          <td class="fv-num" style="color:var(--gold)">
            {{ monthly > 0 ? fmtNT(monthly) : '—' }}
          </td>
          <td style="font-size:12px;color:var(--text-muted)">
            @if (acct) {
              <span class="fv-acct-tag">{{ acct.name }}</span>
            } @else {
              —
            }
          </td>
          <td style="font-size:13px;color:var(--text-muted)">{{ f.note || '—' }}</td>
        </tr>
      }
    </tbody>
  </table>
}

<!-- Modal -->
@if (openModal()) {
  <div class="modal-overlay" (click)="close()">
    <div class="modal-box" style="max-width:520px" (click)="$event.stopPropagation()">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <div style="font-size:17px;font-weight:700">{{ isNew() ? '新增基金' : '編輯基金' }}</div>
        <button class="sidebar-close-btn" (click)="close()">×</button>
      </div>

      <!-- 基本資訊 -->
      <div class="broker-form-group">
        <div class="modal-label">基金名稱</div>
        <input class="modal-input" placeholder="如：統一奔騰基金"
          [value]="f.name" (input)="f.name=asStr($event)" />
      </div>
      <div class="broker-form-row" style="margin-top:12px">
        <div class="broker-form-group" style="flex:1">
          <div class="modal-label">投入成本 (TWD)</div>
          <input class="modal-input" type="number" step="1" min="0"
            [value]="f.cost || ''" (input)="f.cost=toNum($event)" />
        </div>
        <div class="broker-form-group" style="flex:1">
          <div class="modal-label">目前市值 (TWD)</div>
          <input class="modal-input" type="number" step="1" min="0"
            [value]="f.marketValue || ''" (input)="f.marketValue=toNum($event)" />
        </div>
      </div>
      @if (f.cost > 0 && f.marketValue > 0) {
        @let pnl = f.marketValue - f.cost;
        <div style="font-size:12px;margin-top:6px;color:var(--text-muted);text-align:right">
          損益預覽：
          <span [style.color]="pnl >= 0 ? 'var(--green,#27ae60)' : 'var(--red,#c0392b)'">
            {{ (pnl >= 0 ? '+' : '') + fmtNT(pnl) }}（{{ (pnl >= 0 ? '+' : '') + (pnl / f.cost * 100).toFixed(2) }}%）
          </span>
        </div>
      }

      <!-- 扣款帳戶 -->
      @if (state.accounts().length > 0) {
        <div class="broker-form-group" style="margin-top:12px">
          <div class="modal-label">扣款帳戶 <span style="color:var(--text-muted);font-size:11px">（定期定額從此帳戶扣款）</span></div>
          <select class="modal-input" style="padding:8px 10px"
            [value]="f.accountId ?? ''"
            (change)="f.accountId = asStr($event) || null">
            <option value="">— 不連結 —</option>
            @for (a of state.accounts(); track a.id) {
              <option [value]="a.id">{{ a.name }}</option>
            }
          </select>
        </div>
      }

      <div class="broker-form-group" style="margin-top:12px">
        <div class="modal-label">備註 (選填)</div>
        <input class="modal-input" placeholder="如：含低檔智動投"
          [value]="f.note" (input)="f.note=asStr($event)" />
      </div>

      <!-- 定期定額設定 -->
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
        <div style="font-size:13px;font-weight:700;color:var(--text-muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">
          定期定額設定
        </div>

        @if (!isNew()) {
          @let fund = asFund();
          @if (fund && fund.schedules.length > 0) {
            <div class="fv-sched-list">
              @for (s of fund.schedules; track s.id) {
                <div class="fv-sched-row">
                  <span class="fv-sched-day">每月 <strong>{{ s.dayOfMonth }}</strong> 日</span>
                  <span class="fv-sched-amount">{{ fmtNT(s.amount) }}</span>
                  @if (s.note) { <span class="fv-sched-note">{{ s.note }}</span> }
                  <button class="fv-sched-del" (click)="removeSchedule(fund.id, s.id)" title="刪除">×</button>
                </div>
              }
              <div style="font-size:12px;color:var(--text-muted);text-align:right;margin-top:4px">
                每月合計 {{ fmtNT(fund.schedules.reduce((s, sc) => s + sc.amount, 0)) }}
              </div>
            </div>
          } @else if (!isNew()) {
            <div style="font-size:13px;color:var(--text-muted);margin-bottom:10px">尚無扣款設定</div>
          }

          <!-- 新增扣款行 -->
          <div class="fv-sched-add">
            <div style="font-size:12px;color:var(--text-muted);font-weight:700;margin-bottom:6px">新增扣款</div>
            <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
              <div style="flex:0 0 80px">
                <div class="modal-label">扣款日</div>
                <input class="modal-input" type="number" min="1" max="28" placeholder="如：5"
                  [value]="newSched.day || ''" (input)="newSched.day=toInt($event)" />
              </div>
              <div style="flex:1;min-width:120px">
                <div class="modal-label">金額 (TWD)</div>
                <input class="modal-input" type="number" min="1" step="100" placeholder="如：3000"
                  [value]="newSched.amount || ''" (input)="newSched.amount=toNum($event)" />
              </div>
              <div style="flex:1;min-width:100px">
                <div class="modal-label">備註 (選填)</div>
                <input class="modal-input" placeholder="如：智動投"
                  [value]="newSched.note" (input)="newSched.note=asStr($event)" />
              </div>
              <button class="btn-primary" style="padding:8px 16px;white-space:nowrap"
                [disabled]="!newSched.day || !newSched.amount"
                (click)="addSchedule(fund!.id)">新增</button>
            </div>
          </div>
        } @else {
          <div style="font-size:12px;color:var(--text-muted)">請先儲存基金後再設定定期定額扣款</div>
        }
      </div>

      <div style="display:flex;gap:8px;margin-top:20px">
        <button class="btn-primary" style="flex:1" (click)="save()" [disabled]="!f.name.trim()">
          {{ isNew() ? '新增' : '儲存' }}
        </button>
        <button class="btn-cancel" (click)="close()">取消</button>
      </div>
      @if (!isNew()) {
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
          <button class="sig-action-btn danger" style="width:100%" (click)="deleteFund()">
            刪除此基金
          </button>
        </div>
      }
    </div>
  </div>
}
  `,
  styles: [`
    .fv-summary-bar {
      display:flex; flex-wrap:wrap; gap:12px 24px;
      background:var(--panel-bg); border:1.5px solid var(--border);
      border-radius:10px; padding:14px 18px; margin-bottom:16px;
    }
    .fv-summary-item { display:flex; flex-direction:column; gap:4px; }
    .fv-summary-label { font-size:12px; color:var(--text-muted); font-weight:700; }
    .fv-summary-value { font-size:18px; font-weight:700; font-family:'JetBrains Mono',monospace; }
    .fv-num { text-align:right; font-family:'JetBrains Mono',monospace; font-size:13px; white-space:nowrap; }
    .fv-pos { color:var(--green,#27ae60) !important; }
    .fv-neg { color:var(--red,#c0392b) !important; }
    .fv-acct-tag {
      display:inline-block; font-size:11px; font-weight:600;
      background:rgba(52,152,219,.12); color:#3498db;
      border:1px solid rgba(52,152,219,.3); border-radius:4px; padding:1px 6px;
    }
    .fv-sched-list { display:flex; flex-direction:column; gap:6px; margin-bottom:12px; }
    .fv-sched-row {
      display:flex; align-items:center; gap:10px; padding:8px 12px;
      background:var(--panel-bg); border-radius:6px; border:1px solid var(--border);
    }
    .fv-sched-day { font-size:13px; min-width:90px; }
    .fv-sched-day strong { color:var(--gold); font-family:'JetBrains Mono',monospace; }
    .fv-sched-amount { font-size:13px; font-weight:700; font-family:'JetBrains Mono',monospace; flex:1; }
    .fv-sched-note { font-size:12px; color:var(--text-muted); }
    .fv-sched-del { background:none; border:none; cursor:pointer; color:var(--text-muted); font-size:16px; margin-left:auto; padding:2px 4px; line-height:1; }
    .fv-sched-del:hover { color:var(--red,#c0392b); }
    .fv-sched-add { background:var(--panel-bg); border:1px dashed var(--border); border-radius:8px; padding:12px; }
  `],
})
export class FundHoldingsViewComponent {
  openModal = signal<'new' | FundHolding | null>(null);
  f = this.blank();
  newSched = { day: 0, amount: 0, note: '' };

  constructor(public state: AppStateService, private api: ApiService) {}

  blank() { return { name: '', cost: 0, marketValue: 0, note: '', accountId: null as string | null }; }
  isNew()   { return this.openModal() === 'new'; }
  asFund()  { const m = this.openModal(); return m !== 'new' ? m as FundHolding : null; }
  asStr(e: Event) { return (e.target as HTMLInputElement | HTMLSelectElement).value; }
  toNum(e: Event) { return parseFloat((e.target as HTMLInputElement).value) || 0; }
  toInt(e: Event) { return parseInt((e.target as HTMLInputElement).value) || 0; }
  fmtNT(n: number) {
    const abs = Math.abs(n);
    return `${n < 0 ? '-' : ''}NT$${Math.round(abs).toLocaleString()}`;
  }

  totalCost    = computed(() => this.state.funds().reduce((s, f) => s + f.cost, 0));
  totalMV      = computed(() => this.state.funds().reduce((s, f) => s + f.marketValue, 0));
  totalPnL     = computed(() => this.totalMV() - this.totalCost());
  totalMonthly = computed(() =>
    this.state.funds().reduce((s, f) => s + f.schedules.reduce((ss, sc) => ss + sc.amount, 0), 0)
  );

  openNew() { this.f = this.blank(); this.openModal.set('new'); }
  openEdit(fund: FundHolding) {
    this.f = { name: fund.name, cost: fund.cost, marketValue: fund.marketValue, note: fund.note, accountId: fund.accountId };
    this.newSched = { day: 0, amount: 0, note: '' };
    this.openModal.set(fund);
  }
  close() { this.openModal.set(null); }

  async save() {
    if (!this.f.name.trim()) return;
    if (this.isNew()) {
      const fund: FundHolding = {
        id: uid(), ...this.f, name: this.f.name.trim(), note: this.f.note.trim(),
        accountId: this.f.accountId, schedules: [],
      };
      const saved = await this.api.createFund(fund);
      this.state.addFund(saved);
    } else {
      const id = (this.openModal() as FundHolding).id;
      const saved = await this.api.patchFund(id, {
        name: this.f.name.trim(), cost: this.f.cost,
        marketValue: this.f.marketValue, note: this.f.note.trim(),
        accountId: this.f.accountId,
      });
      this.state.updateFund(saved);
    }
    this.close();
  }

  async addSchedule(fundId: string) {
    if (!this.newSched.day || !this.newSched.amount) return;
    const s: FundSchedule = { id: uid(), dayOfMonth: this.newSched.day, amount: this.newSched.amount, note: this.newSched.note.trim() };
    const saved = await this.api.createFundSchedule(fundId, s);
    this.state.addFundSchedule(fundId, saved);
    const updated = this.state.funds().find(f => f.id === fundId);
    if (updated) this.openModal.set(updated);
    this.newSched = { day: 0, amount: 0, note: '' };
  }

  async removeSchedule(fundId: string, scheduleId: string) {
    await this.api.deleteFundSchedule(fundId, scheduleId);
    this.state.removeFundSchedule(fundId, scheduleId);
    const updated = this.state.funds().find(f => f.id === fundId);
    if (updated) this.openModal.set(updated);
  }

  async deleteFund() {
    const id = (this.openModal() as FundHolding).id;
    await this.api.deleteFund(id);
    this.state.removeFund(id);
    this.close();
  }
}
