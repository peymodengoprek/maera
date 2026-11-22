/** Gaya dasar + tema lewat CSS variables `--m-*`. Tema dipilih lewat atribut `data-theme`. */
export const STYLE_ID = "maera-styles";

export const CSS = `
.maera{
  --m-bg:#f4f6f8; --m-surface:#ffffff; --m-border:#e2e6ea;
  --m-text:#14202b; --m-muted:#667785; --m-accent:#0f9d8a; --m-track:#e6ebef;
  --m-ok:#16a34a; --m-info:#2563eb; --m-warning:#d97706; --m-danger:#dc2626;
  --m-radius:14px; --m-gap:16px;
  --m-font:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  box-sizing:border-box; min-height:100%; padding:24px;
  background:var(--m-bg); color:var(--m-text); font-family:var(--m-font);
}
.maera[data-theme="dark"]{
  --m-bg:#0d141b; --m-surface:#16212b; --m-border:#243240;
  --m-text:#e7eef4; --m-muted:#8b9eae; --m-accent:#3ddbc0; --m-track:#243240;
  --m-ok:#4ade80; --m-info:#60a5fa; --m-warning:#fbbf24; --m-danger:#f87171;
}
.maera *,.maera *::before,.maera *::after{box-sizing:border-box}
.maera-header{margin:0 0 var(--m-gap)}
.maera-title{margin:0;font-size:1.5rem;font-weight:650;letter-spacing:-.01em}
.maera-grid{display:grid;gap:var(--m-gap)}
.maera-widget{
  grid-column:span var(--m-span,3); min-width:0;
  background:var(--m-surface); border:1px solid var(--m-border);
  border-radius:var(--m-radius); padding:16px 18px;
}
.maera-widget[data-status="ok"]{--m-status:var(--m-ok)}
.maera-widget[data-status="info"]{--m-status:var(--m-info)}
.maera-widget[data-status="warning"]{--m-status:var(--m-warning)}
.maera-widget[data-status="danger"]{--m-status:var(--m-danger)}
.maera-widget-title{margin:0 0 10px;font-size:.8rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--m-muted)}
.maera-stat{display:flex;align-items:baseline;gap:6px}
.maera-stat-value{font-size:2.4rem;font-weight:650;line-height:1.1;font-variant-numeric:tabular-nums;color:var(--m-status,var(--m-text));transition:color .3s}
.maera-caption{margin-top:8px;font-size:.9rem;font-weight:600;color:var(--m-status,var(--m-muted))}
.maera-caption:empty{display:none}
.maera-gauge+.maera-caption{text-align:center}
.maera-stat-unit{font-size:1rem;color:var(--m-muted)}
.maera-gauge{display:block;width:100%;max-width:260px;margin:0 auto}
.maera-gauge-track{stroke:var(--m-track)}
.maera-gauge-fill{stroke:var(--m-status,var(--m-accent));transition:stroke-dasharray .4s ease,stroke .3s}
.maera-gauge-value{fill:var(--m-text);font-size:26px;font-weight:650;font-variant-numeric:tabular-nums}
.maera-gauge-unit{fill:var(--m-muted);font-size:12px}
.maera-gauge-limit{fill:var(--m-muted);font-size:10px}
.maera-status{display:flex;align-items:center;gap:12px;font-size:1.5rem;font-weight:650}
.maera-status-dot{width:14px;height:14px;border-radius:50%;background:var(--m-track);flex:none;transition:background .3s,box-shadow .3s}
.maera-status[data-state="on"] .maera-status-dot{background:var(--m-status,var(--m-accent));box-shadow:0 0 0 5px color-mix(in srgb,var(--m-status,var(--m-accent)) 25%,transparent)}
.maera-status[data-state="off"] .maera-status-dot{background:var(--m-muted)}
.maera-status[data-state="unknown"] .maera-status-label{color:var(--m-muted)}
.maera-chart-svg{display:block;width:100%;height:120px}
.maera-chart-grid{stroke:var(--m-border);stroke-width:1;vector-effect:non-scaling-stroke}
.maera-chart-area{fill:var(--m-accent);opacity:.14;stroke:none}
.maera-chart-line{fill:none;stroke:var(--m-accent);stroke-width:2;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
.maera-chart-meta{display:flex;justify-content:space-between;gap:12px;margin-top:8px;font-size:.8rem;color:var(--m-muted);font-variant-numeric:tabular-nums}
.maera-chart-now{color:var(--m-text);font-weight:600}
.maera-text{margin:0;line-height:1.5}
.maera-unsupported{margin:0;color:var(--m-muted);font-size:.85rem;font-style:italic}
@media (max-width:640px){.maera-widget{grid-column:1/-1}.maera{padding:16px}}
`;

/** Pasang gaya sekali per dokumen (idempoten). */
export function injectStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.appendChild(style);
}