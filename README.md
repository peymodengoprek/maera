<div align="center">

# ⚡ Maera

**Turn a single YAML file into a live, reactive IoT dashboard in seconds.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Monorepo](https://img.shields.io/badge/Architecture-Monorepo-orange)](https://github.com/)

[Key Features](#-key-features) • [Quick Start](#-quick-start) • [Example Configuration](#-example-configuration) • [Syntax Reference](docs/syntax.md) • [Packages](#-monorepo-structure) • [Roadmap](#-roadmap)

</div>

---

## ✨ Why Maera?

Building IoT dashboards often requires drowning in boilerplate—setting up UI frameworks, wiring state management, configuring build tools, and handling WebSocket/REST polling logic just to monitor a few sensors.

**Maera changes that.** 

With Maera, **1 file (`index.maera`) = 1 production-ready IoT dashboard**. You write declarative configuration in clean YAML syntax, and Maera takes care of state management, data binding, threshold evaluations, and beautiful UI rendering automatically.

### 🌟 Highlights

- **📄 Zero Boilerplate:** Write your entire dashboard interface and data subscriptions in a single `.maera` file.
- **⚡ Reactive Data Core:** Powered by `@maera-js/core`, featuring built-in pub/sub state handling and lightweight REST polling & mock generators.
- **🎨 Modern & Responsive UI:** Pre-built responsive widgets (stat tiles, gauges, charts, status indicators) with automatic dark/light theme switching.
- **🚀 Developer-First CLI:** Zero-config dev server with instant live reloading (`maera dev`) and quick static single-file builds (`maera build`).
- **🛡️ Strictly Typed & Tested:** Zero-DOM core module written in pure TypeScript with step-by-step diagnostic line error tracing.

---

## 🚀 Quick Start

### 1. Install Maera CLI

```bash
# Global installation via npm
npm install -g @maera-js/cli
```

### 2. Create your dashboard configuration

Create a file named `index.maera`:

```yaml
app:
  title: "Greenhouse Monitor"
  theme: "dark"

sources:
  temperature:
    type: mock
    interval: 2000
    min: 20
    max: 35

widgets:
  - type: gauge
    title: "Ambient Temperature"
    bind: temperature.value
    unit: "°C"
    min: 0
    max: 50
    span: 6
    state:
      threshold: 30
      above:
        status: danger
        text: "High Temperature Alert"
      below:
        status: ok
        text: "Optimal Range"
```

### 3. Launch Development Server

```bash
maera dev index.maera
```

🎉 Open your browser at `http://localhost:3000` to see your dashboard live-updating in real-time!

---

## 🛠️ Monorepo Structure

Maera is architected as a modular TypeScript monorepo using **npm workspaces**:

```text
maera/
├── packages/
│   ├── core/      # @maera-js/core — Zero-DOM YAML compiler & reactive store
│   ├── ui/        # @maera-js/ui   — Modular DOM/SVG widget renderer & theme system
│   └── cli/       # @maera-js/cli  — Developer CLI tools (dev server & builder)
├── examples/      # Sample configuration files & playground demos
└── README.md
```

### Core Packages Overview

| Package | Description | Status |
| :--- | :--- | :---: |
| **`@maera-js/core`** | AST Compiler, schema validator, line-by-line error reporter, reactive pub-sub data store, and mock/REST data polling sources. | `v0.3.0` ✅ |
| **`@maera-js/ui`** | Responsive 12-column grid layout, SVG gauge/chart renderers, theme engine (`--m-*`), and conditional state evaluators (`state:` / `steps:`). | `v0.3.0` ✅ |
| **`@maera-js/cli`** | Command-line tool featuring instant dev server, esbuild watch-mode, live reload, and standalone static HTML bundle builder. | `v0.3.0` ✅ |

---

## 🎨 Example Configuration

Here is a full breakdown of how intuitive a `.maera` file is:

```yaml
app:
  title: "Solar Power Station"
  theme: "dark"
  columns: 12

sources:
  solar_output:
    type: rest
    url: "https://api.solar-station.local/telemetry"
    interval: 5000

widgets:
  - type: stat
    title: "Current Voltage"
    bind: solar_output.voltage
    unit: "V"
    span: 4

  - type: status
    title: "Inverter Health"
    bind: solar_output.status_code
    span: 4
    steps:
      - at: 200
        status: ok
        text: "System Normal"
      - at: 400
        status: warning
        text: "Degraded Mode"
      - status: danger
        text: "System Fault"

  - type: chart
    title: "Power Output History"
    bind: solar_output.wattage
    span: 12
    points: 30
```

For the complete reference of every `app`, `sources`, and `widgets` property,
conditions, and CLI options, see **[docs/syntax.md](docs/syntax.md)**.

---

## 🗺️ Roadmap

- **v0.1 — Complete ✅** Core compiler with line-by-line diagnostics, reactive
  pub/sub store, mock/REST sources, 12-column UI with stat/gauge/chart/status/text
  widgets, and `maera dev` / `maera build`.
- **v0.2 — Complete ✅** WebSocket and MQTT real-time sources, interactive
  `switch`/`slider` widgets with a two-way write path, generated JSON Schema for
  editor validation, and this full syntax reference.
- **v0.3 — Planned 🚧** Live Playground and documentation site.

---

## 📄 License

Maera is open-source software licensed under the [MIT License](LICENSE).

---

<div align="center">
Built with ❤️ for IoT enthusiasts and developers.
</div>