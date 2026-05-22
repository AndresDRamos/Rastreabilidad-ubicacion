const intFmt = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
const decFmt = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 });

export function fmtInt(n: number): string {
  return intFmt.format(Math.round(n));
}

export function fmtNum(n: number): string {
  if (Math.abs(n - Math.round(n)) < 1e-6) return intFmt.format(Math.round(n));
  return decFmt.format(n);
}
