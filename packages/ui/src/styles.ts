/** Gaya dasar + tema lewat CSS variables `--m-*`. Tema dipilih lewat atribut `data-theme`. */
export const STYLE_ID = "maera-styles";

export const CSS = `
.maera{
  --m-bg:#f4f6f8; --m-surface:#ffffff; --m-border:#e2e6ea;
  --m-text:#14202b; --m-muted:#667785; --m-accent:#0f9d8a; --m-track:#e6ebef;
  --m-ok:#15803d; --m-info:#2563eb; --m-warning:#b45309; --m-danger:#dc2626;
  --m-radius:14px; --m-gap:16px; --m-row-height:110px;
  --m-font:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  container-type:inline-size;
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
.maera-grid{
  display:grid;
  grid-template-columns:repeat(12, minmax(0, 1fr));
  grid-auto-rows:minmax(var(--m-row-height, 110px), auto);
  grid-auto-flow:row;
  gap:var(--m-gap);
}
.maera-widget, .maera-card{
  box-sizing:border-box;
  height:100%;
  display:flex;
  flex-direction:column;
  min-width:0;
  grid-column:span var(--m-cols, var(--m-span, 3));
  grid-row:span var(--m-rows, 1);
  background:var(--m-surface);
  border:1px solid var(--m-border);
  border-radius:var(--m-radius);
  padding:16px 18px;
}
.maera-widget-body{
  display:flex;
  flex-direction:column;
  flex:1 1 auto;
  min-height:0;
  justify-content:center;
}
.maera-widget[data-status="ok"]{--m-status:var(--m-ok)}
.maera-widget[data-status="info"]{--m-status:var(--m-info)}
.maera-widget[data-status="warning"]{--m-status:var(--m-warning)}
.maera-widget[data-status="danger"]{--m-status:var(--m-danger)}
.maera-widget-title{margin:0 0 10px;font-size:.8rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--m-muted);flex:none}
.maera-stat{display:flex;align-items:baseline;gap:6px}
.maera-stat-value{font-size:clamp(1.6rem, 5cqi, 2.4rem);font-weight:650;line-height:1.1;font-variant-numeric:tabular-nums;color:var(--m-status,var(--m-text));transition:color .3s}
.maera-caption{margin-top:8px;font-size:.9rem;font-weight:600;color:var(--m-status,var(--m-muted))}
.maera-caption:empty{display:none}
.maera-gauge+.maera-caption{text-align:center;flex:none}
.maera-stat-unit{font-size:1rem;color:var(--m-muted)}
.maera-gauge{display:block;width:100%;height:100%;max-width:260px;margin:auto;flex:1 1 auto}
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
.maera-chart-svg{display:block;width:100%;height:100%;min-height:100px;flex:1 1 auto}
.maera-chart-grid{stroke:var(--m-border);stroke-width:1;vector-effect:non-scaling-stroke}
.maera-chart-area{fill:var(--m-status,var(--m-accent));opacity:.14;stroke:none}
.maera-chart-line{fill:none;stroke:var(--m-status,var(--m-accent));stroke-width:2;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
.maera-chart-meta{display:flex;justify-content:space-between;gap:12px;margin-top:8px;font-size:.8rem;color:var(--m-muted);font-variant-numeric:tabular-nums;flex:none}
.maera-chart-now{color:var(--m-text);font-weight:600}
.maera-text{margin:0;line-height:1.5}
.maera-widget[data-write="pending"]{border-color:var(--m-info)}
.maera-widget[data-write="error"]{border-color:var(--m-danger)}
.maera-switch{display:flex;flex-direction:column;gap:8px}
.maera-switch-label{display:flex;align-items:center;gap:12px;cursor:pointer;font-weight:600}
.maera-switch-input{
  appearance:none;-webkit-appearance:none;position:relative;flex:none;
  width:46px;height:26px;margin:0;border-radius:999px;cursor:pointer;
  background:var(--m-track);border:1px solid var(--m-border);
  transition:background .2s ease,border-color .2s ease;
}
.maera-switch-input::after{
  content:"";position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;
  background:var(--m-surface);border:1px solid var(--m-border);
  transition:transform .2s ease,background .2s ease;
}
.maera-switch-input:checked{background:var(--m-accent);border-color:var(--m-accent)}
.maera-switch-input:checked::after{transform:translateX(20px);background:var(--m-surface)}
.maera-switch-input:focus-visible{outline:2px solid var(--m-accent);outline-offset:2px}
.maera-switch-input:disabled{cursor:progress;opacity:.65}
.maera-switch[data-state="unknown"] .maera-switch-label{color:var(--m-muted)}
.maera-slider{display:flex;flex-direction:column;gap:8px}
.maera-slider-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.maera-slider-value{font-size:1.35rem;font-weight:650;font-variant-numeric:tabular-nums;color:var(--m-text)}
.maera-slider-input{width:100%;margin:0;accent-color:var(--m-accent);cursor:pointer}
.maera-slider-input:focus-visible{outline:2px solid var(--m-accent);outline-offset:2px}
.maera-slider-input:disabled{cursor:progress;opacity:.65}
.maera-control-status{margin:0;font-size:.82rem;font-weight:600;color:var(--m-muted);min-height:1.1em}
.maera-control-status:empty{display:none}
.maera-control-status[data-kind="pending"]{color:var(--m-info)}
.maera-control-status[data-kind="error"]{color:var(--m-danger)}
.maera-unsupported{margin:0;color:var(--m-muted);font-size:.85rem;font-style:italic}
@container (max-width: 599px){
  .maera-widget, .maera-card{grid-column:1/-1 !important;grid-row:auto !important}
  .maera{padding:16px}
}
@container (min-width: 600px) and (max-width: 959px){
  .maera-widget, .maera-card{grid-column:span 6 !important}
  .maera-widget[data-cols="7"],.maera-widget[data-cols="8"],.maera-widget[data-cols="9"],
  .maera-widget[data-cols="10"],.maera-widget[data-cols="11"],.maera-widget[data-cols="12"],
  .maera-card[data-cols="7"],.maera-card[data-cols="8"],.maera-card[data-cols="9"],
  .maera-card[data-cols="10"],.maera-card[data-cols="11"],.maera-card[data-cols="12"]{
    grid-column:span 12 !important;
  }
}
@container (min-width: 960px){
  .maera-widget, .maera-card{
    grid-column:span var(--m-cols, var(--m-span, 3));
    grid-row:span var(--m-rows, 1);
  }
}
`;

/** Pasang gaya sekali per dokumen (idempoten). */
export function injectStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.appendChild(style);
}