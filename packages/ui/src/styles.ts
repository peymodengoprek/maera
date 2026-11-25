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
  min-height:0;
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
.maera-gauge-stack{display:flex;flex-direction:column;align-items:center;min-height:0}
.maera-gauge-body{position:relative;flex:1 1 auto;align-self:stretch;width:100%;min-height:0}
.maera-stat-unit{font-size:1rem;color:var(--m-muted)}
.maera-gauge{position:absolute;inset:0;display:block;width:100%;height:100%;margin:auto}
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
.maera-chart-body{position:relative;flex:1;min-height:0;width:100%}
.maera-chart-svg{position:absolute;inset:0;width:100%;height:100%;display:block}
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
.maera-widget[data-rows="1"] .maera-widget-body{gap:2px}
.maera-widget[data-rows="1"] .maera-widget-title{margin-bottom:6px}
.maera-widget[data-rows="1"] .maera-caption{margin-top:4px;font-size:.82rem}
.maera-widget[data-rows="1"] .maera-chart-meta{margin-top:4px}
.maera-widget:not([data-rows="1"]) .maera-widget-body{gap:clamp(8px, calc(var(--m-rows, 2) * 4px), 20px)}
.maera-widget:not([data-rows="1"]) .maera-stat{justify-content:center}
.maera-widget:not([data-rows="1"]) .maera-stat-value{font-size:clamp(2.2rem, calc(var(--m-rows, 2) * 0.9rem + 2cqi), 4rem)}
.maera-widget:not([data-rows="1"]) .maera-caption{margin-top:clamp(8px, calc(var(--m-rows, 2) * 4px), 18px)}
.maera-widget:not([data-rows="1"]) .maera-status{font-size:clamp(1.6rem, calc(var(--m-rows, 2) * 0.4rem + 1.2cqi), 2.6rem);gap:clamp(12px, calc(var(--m-rows, 2) * 4px), 22px)}
.maera-widget:not([data-rows="1"]) .maera-status-dot{width:clamp(14px, calc(var(--m-rows, 2) * 4px), 24px);height:clamp(14px, calc(var(--m-rows, 2) * 4px), 24px)}
.maera-widget:not([data-rows="1"]) .maera-text{font-size:clamp(1rem, calc(var(--m-rows, 2) * 0.15rem + 0.85rem), 1.35rem);line-height:1.6}
.maera-widget:not([data-rows="1"]) .maera-switch{gap:clamp(8px, calc(var(--m-rows, 2) * 4px), 18px)}
.maera-widget:not([data-rows="1"]) .maera-switch-input{transform:scale(1.15);transform-origin:left center}
.maera-widget:not([data-rows="1"]) .maera-slider{gap:clamp(8px, calc(var(--m-rows, 2) * 4px), 18px)}
.maera-widget:not([data-rows="1"]) .maera-slider-value{font-size:clamp(1.5rem, calc(var(--m-rows, 2) * 0.2rem + 1rem), 2.2rem)}
.maera-widget[data-type="gauge"]{flex-direction:column;align-items:center}
.maera-widget[data-type="gauge"] .maera-widget-body{
  display:flex;flex-direction:column;align-items:center;width:100%;flex:1 1 auto;min-height:0;
}
.maera-widget[data-type="gauge"] .maera-gauge-stack{
  flex:1 1 auto;align-self:stretch;width:100%;min-height:0;
  display:flex;flex-direction:column;align-items:center;
}
.maera-widget[data-type="gauge"] .maera-caption{text-align:center;flex:none}
.maera-widget[data-type="gauge"][data-rows="1"]{
  flex-direction:row;align-items:stretch;justify-content:space-between;gap:12px;
}
.maera-widget[data-type="gauge"][data-rows="1"] .maera-widget-title{
  align-self:flex-start;flex:1;min-width:0;margin:0;
}
.maera-widget[data-type="gauge"][data-rows="1"] .maera-widget-body{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  flex:0 0 auto;min-width:0;min-height:0;
}
.maera-widget[data-type="gauge"][data-rows="1"] .maera-gauge-stack{
  height:100%;flex:0 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;
}
.maera-widget[data-type="gauge"][data-rows="1"] .maera-gauge-body{
  flex:1 1 auto;min-height:0;width:auto;align-self:center;aspect-ratio:200/130;
}
@container (max-width: 599px){
  .maera-widget, .maera-card{grid-column:1/-1 !important;grid-row:auto !important}
  .maera-chart-body{min-height:56px}
  .maera-gauge-body{min-height:56px}
  .maera-widget[data-type="gauge"][data-rows="1"]{flex-direction:column;align-items:center}
  .maera-widget[data-type="gauge"][data-rows="1"] .maera-widget-title{align-self:stretch;flex:none}
  .maera-widget[data-type="gauge"][data-rows="1"] .maera-widget-body{
    flex:1 1 auto;width:100%;align-self:stretch;
  }
  .maera-widget[data-type="gauge"][data-rows="1"] .maera-gauge-stack{
    height:auto;width:100%;flex:1 1 auto;
  }
  .maera-widget[data-type="gauge"][data-rows="1"] .maera-gauge-body{
    width:100%;align-self:stretch;min-height:120px;aspect-ratio:auto;
  }
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
.maera-diagnostics-overlay{
  position:fixed;inset:0;z-index:2147483000;
  display:flex;align-items:flex-start;justify-content:center;
  padding:clamp(16px,4vw,40px);overflow:auto;
  background:rgba(4,8,12,.86);color:#f2f7fb;
  font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",Menlo,monospace;
}
.maera-diagnostics{
  width:min(1040px,100%);background:#0f1720;color:#f2f7fb;
  border:1px solid #33465a;border-radius:14px;
  box-shadow:0 24px 80px rgba(0,0,0,.55);overflow:hidden;
}
.maera-diagnostics-header{
  display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:16px;
  padding:20px 24px;background:#16232f;border-bottom:1px solid #33465a;
}
.maera-diagnostics-kicker{margin:0 0 4px;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:#9fb3c8}
.maera-diagnostics-title{margin:0;font-size:1.35rem;font-weight:700;color:#ffd7d7}
.maera-diagnostics-summary{margin:8px 0 0;font-size:.82rem;color:#c6d4e1}
.maera-diagnostics-actions{display:flex;gap:8px;flex-wrap:wrap}
.maera-diagnostics-actions button{
  font:inherit;font-size:.82rem;font-weight:700;border-radius:8px;
  padding:8px 14px;cursor:pointer;border:1px solid transparent;
}
.maera-diagnostics-copy{background:#5eead4;color:#04211d;border-color:#99f6e4}
.maera-diagnostics-close{background:#f8fafc;color:#0f1720;border-color:#cbd5e1}
.maera-diagnostics-actions button:hover{filter:brightness(1.08)}
.maera-diagnostics-actions button:focus-visible{outline:3px solid #fbbf24;outline-offset:2px}
.maera-diagnostics-copy[data-state="failed"]{background:#ffd7d7;color:#6b0f0f}
.maera-diagnostics-body{
  padding:20px 24px 24px;display:flex;flex-direction:column;gap:18px;
  max-height:calc(100vh - 220px);overflow:auto;
}
.maera-diagnostic{
  background:#0b1218;border:1px solid #2a3a4a;border-left:4px solid #ff8f8f;
  border-radius:10px;padding:16px;
}
.maera-diagnostic-meta{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:10px}
.maera-diagnostic-code{
  background:#ff8f8f;color:#2a0505;border-radius:6px;padding:2px 8px;
  font-size:.72rem;font-weight:800;letter-spacing:.04em;
}
.maera-diagnostic-location{font-size:.8rem;color:#d7e2ec;font-weight:700}
.maera-diagnostic-path{font-size:.76rem;color:#9fb3c8}
.maera-diagnostic-message{margin:0 0 8px;font-size:.9rem;line-height:1.5;color:#f2f7fb}
.maera-diagnostic-suggestion{margin:0 0 12px;font-size:.84rem;color:#bae6fd}
.maera-diagnostic-suggestion code{background:#153046;color:#e0f2fe;border-radius:4px;padding:1px 5px}
.maera-code-frame{
  margin:0;background:#060b10;border:1px solid #223140;border-radius:8px;
  padding:12px 14px;overflow:auto;font-size:.8rem;line-height:1.55;color:#dbe7f1;
}
.maera-code-frame-body{font:inherit;white-space:pre;display:block}
.maera-code-frame-line{display:block;padding:0 6px;border-left:2px solid transparent}
.maera-code-frame-line[data-highlight="true"]{
  background:rgba(255,143,143,.16);border-left-color:#ff8f8f;color:#ffe4e4;font-weight:700;
}
.maera-code-frame-gutter{display:inline-block;width:2.5em;text-align:right;color:#7c8b99;user-select:none}
.maera-code-frame-line[data-highlight="true"] .maera-code-frame-gutter{color:#ffb4b4}
.maera-code-frame-caret{color:#ff8f8f}
.maera-diagnostics-panel{
  position:fixed;right:16px;bottom:16px;z-index:2147482000;
  width:min(380px,calc(100vw - 32px));
  background:#0f1720;color:#f2f7fb;border:1px solid #b45309;border-radius:12px;
  box-shadow:0 16px 40px rgba(0,0,0,.4);overflow:hidden;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
}
.maera-diagnostics-panel-toggle{
  display:flex;align-items:center;gap:10px;width:100%;padding:10px 14px;
  background:#1f2937;color:#fef3c7;border:0;font:inherit;font-size:.85rem;
  font-weight:700;text-align:left;cursor:pointer;
}
.maera-diagnostics-panel-toggle:focus-visible{outline:3px solid #fbbf24;outline-offset:-3px}
.maera-diagnostics-panel-icon{
  display:inline-flex;align-items:center;justify-content:center;flex:none;
  width:20px;height:20px;border-radius:50%;background:#fbbf24;color:#3b2503;font-weight:900;
}
.maera-diagnostics-panel-list{list-style:none;margin:0;padding:0;max-height:40vh;overflow:auto}
.maera-diagnostics-panel[data-open="false"] .maera-diagnostics-panel-list{display:none}
.maera-diagnostics-panel-item{
  display:flex;flex-wrap:wrap;gap:8px;padding:10px 14px;
  border-top:1px solid #2a3a4a;font-size:.8rem;
}
.maera-diagnostics-panel-item .maera-diagnostic-code{background:#fbbf24;color:#3b2503}
.maera-diagnostics-panel-item[data-severity="info"] .maera-diagnostic-code{background:#60a5fa;color:#041a33}
`;

/** Pasang gaya sekali per dokumen (idempoten). */
export function injectStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.appendChild(style);
}