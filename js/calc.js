// calc.js — 純計算邏輯,1:1 對齊桌面版 calc_diff
// 桌面版出處:應收帳款填入工具_美化版.py 第 580 行 calc_diff()

export function num(v) {
  if (v === null || v === undefined) return 0;
  const s = String(v).replace(/,/g, '').trim();
  if (s === '') return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

// 對齊 Python 的 round() — banker's rounding(half-to-even)。
// 這對 5% 稅金計算至關重要:例如 round(0.5) Python 是 0,JS Math.round 卻是 1。
function roundBanker(x) {
  if (!Number.isFinite(x)) return 0;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const floor = Math.floor(ax);
  const diff = ax - floor;
  let rounded;
  if (Math.abs(diff - 0.5) < 1e-9) {
    rounded = floor % 2 === 0 ? floor : floor + 1;
  } else {
    rounded = Math.round(ax);
  }
  return sign * rounded;
}

// 主計算入口
// state 形狀:
// {
//   receivable, cash, cashPercent, other, unpaid, overpaid,
//   eClass1, eClass2,
//   allowance1, allowance2, allowance3, ledPercent, tailDiscount,
//   advance,                     // 預收(展示用,不參與差額)
//   checks: [{ date, amount }],
//   remits: [{ date, amount }],
// }
export function compute(state) {
  const receivable = num(state.receivable);
  const cash       = num(state.cash);
  const cashPercent= num(state.cashPercent);
  const other      = num(state.other);
  const unpaid     = num(state.unpaid);
  const eClass1    = num(state.eClass1);
  const eClass2    = num(state.eClass2);
  const a1         = num(state.allowance1);
  const a2         = num(state.allowance2);
  const a3         = num(state.allowance3);
  const ledPercent = num(state.ledPercent);
  const tail       = num(state.tailDiscount);

  const sumChecks = sum((state.checks || []).map(c => num(c.amount)));
  const sumRemits = sum((state.remits || []).map(r => num(r.amount)));

  const eTotal    = eClass1 + eClass2;
  const gaPercent = roundBanker(eTotal * 0.05);   // 對齊 Python round()
  const gaTax     = roundBanker(gaPercent * 0.05);
  const ledTax    = roundBanker(ledPercent * 0.05);
  const tax1      = roundBanker(a1 * 0.05);
  const tax2      = roundBanker(a2 * 0.05);
  const tax3      = roundBanker(a3 * 0.05);

  // 桌面版定義:現金側包含 現金% / 未收 / 其他
  const cashSide = cash + sumRemits + sumChecks + cashPercent + unpaid + other;

  // 折讓側
  const allowanceTotal    = a1 + a2 + a3 + gaPercent + ledPercent + tail;
  const allowanceTaxTotal = tax1 + tax2 + tax3 + gaTax + ledTax;

  // 差額 = 應收 - 收款側 - 折讓 - 折讓稅
  const diff = receivable - cashSide - allowanceTotal - allowanceTaxTotal;

  let status;
  if (Math.abs(diff) < 0.5) status = 'balanced';
  else if (diff > 0) status = 'unpaid';
  else status = 'overpaid';

  return {
    derived: {
      sumChecks, sumRemits,
      eTotal, gaPercent, gaTax,
      ledTax, tax1, tax2, tax3,
      cashSide, allowanceTotal, allowanceTaxTotal,
    },
    diff,
    suggestedUnpaid: diff > 0 ? roundBanker(diff) : 0,
    suggestedOverpaid: diff < 0 ? Math.abs(roundBanker(diff)) : 0,
    status,
  };
}

// 格式化金額顯示(整數 + 千分位)
export function fmt(n, decimals = 0) {
  const v = num(n);
  return v.toLocaleString('zh-TW', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
