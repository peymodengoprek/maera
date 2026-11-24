# Maera Syntax Reference

A Maera dashboard is a single YAML document saved with the `.maera` extension
(for example `index.maera`). **One file defines one dashboard.** This reference
documents every key accepted by the compiler in `@maera/core`.

- [Top-level structure](#top-level-structure)
- [Sources](#sources)
- [Widgets](#widgets)
- [Conditions](#conditions-state-and-steps)
- [CLI reference](#cli-reference)
- [Editor integration](#editor-integration-json-schema)
- [Complete examples](#complete-examples)

---

## Top-level structure

Every file must contain exactly the three top-level keys `app`, `sources`, and
`widgets`. Any other top-level key is rejected.

```text
app:       dashboard identity and grid layout
sources:   map of <source-name> -> source definition
widgets:   ordered list of widgets rendered on the grid
```

| Key | Type | Required | Notes |
| :--- | :--- | :---: | :--- |
| `app` | object | ✅ | See [App](#app). |
| `sources` | object | ✅ | Map of source name to source definition. |
| `widgets` | array | ✅ | Ordered list of widget definitions. |

### App

| Property | Type | Required | Default | Notes |
| :--- | :--- | :---: | :--- | :--- |
| `title` | string | ✅ | — | Non-empty dashboard title. |
| `theme` | string | ❌ | `"default"` | Theme name applied to the dashboard root. |
| `columns` | integer | ❌ | `12` | Grid width, integer from `1` to `12`. |

### Source names and bindings

A source name must match `[A-Za-z_][A-Za-z0-9_-]*`: it starts with a letter or
underscore and may contain letters, digits, `_`, and `-`. Names may not start
with a digit.

Widgets read data with `bind: <source>.<path>`. The binding must contain at
least one dot, for example `temperature.value` or `sensor.room.temperature`.
The first segment is the source name; the remaining segments form the property
path inside that source's data. A binding that references an unknown source is
a compile error.

`mock` and `rest` sources emit one object per tick. When an incoming scalar is
received, Maera stores it as `{ value: <scalar> }`, so `bind: <source>.value`
always works for scalar data.

---

## Sources

All sources share the required `type` property. Each source definition accepts
only the properties listed for its type; unknown properties are compile errors.
Every source is writable through `switch` and `slider` widgets, with the
behaviour described in [Writing values](#writing-values).

### `mock`

Generates a random walk for demos without a backend.

| Property | Type | Required | Default | Notes |
| :--- | :--- | :---: | :--- | :--- |
| `type` | `"mock"` | ✅ | — | Source discriminator. |
| `interval` | number | ❌ | `1000` | Emit interval in milliseconds, `>= 50`. |
| `min` | number | ❌ | `0` | Lower bound of the random walk. |
| `max` | number | ❌ | `100` | Upper bound of the random walk. |
| `unit` | string | ❌ | — | Unit attached to emitted data. |

`min` must be strictly smaller than `max`. The source emits
`{ value: <number>, unit?: <string> }` immediately and then every `interval`
milliseconds. Writing to `value` updates the current value and the walk
continues from there.

### `rest`

Polls a JSON endpoint with HTTP `GET` and writes updates back to the server.

| Property | Type | Required | Default | Notes |
| :--- | :--- | :---: | :--- | :--- |
| `type` | `"rest"` | ✅ | — | Source discriminator. |
| `url` | string | ✅ | — | Endpoint URL, must start with `http://` or `https://`. |
| `interval` | number | ❌ | `5000` | Polling interval in milliseconds, `>= 50`. |
| `path` | string | ❌ | — | Dot path into the JSON response, for example `data.temp`. |
| `headers` | object | ❌ | — | Extra request headers as a map of string to string. |
| `write_url` | string | ❌ | `url` | Write endpoint, must start with `http://` or `https://`. |
| `write_method` | string | ❌ | `"POST"` | One of `POST`, `PUT`, `PATCH` (case-insensitive). |

Requests are sequential: the next poll is scheduled after the previous one
finishes. When `path` is set, the value at that path is stored; primitive
values become `{ value: <scalar> }`. When `path` is omitted, the response body
is stored as-is. Failures are reported through the UI mount `onError` hook and
do not stop polling.

### `websocket`

Maintains a real-time WebSocket connection with automatic reconnection.

| Property | Type | Required | Default | Notes |
| :--- | :--- | :---: | :--- | :--- |
| `type` | `"websocket"` | ✅ | — | Source discriminator. |
| `url` | string | ✅ | — | Socket URL, must start with `ws://` or `wss://`. |
| `path` | string | ❌ | — | Dot path into parsed JSON messages, for example `data.temp`. |
| `reconnect_ms` | number | ❌ | `1000` | Initial reconnect delay in milliseconds, `>= 50`. |
| `max_reconnect_ms` | number | ❌ | `30000` | Maximum reconnect delay in milliseconds, `>= 50`. |

Incoming text frames are parsed as JSON when possible, otherwise treated as a
plain string. Objects are stored directly; primitives become
`{ value: <scalar> }`. `reconnect_ms` must be less than or equal to
`max_reconnect_ms`.

Reconnection uses exponential backoff: `min(max_reconnect_ms,
reconnect_ms * 2^attempt)` plus up to 10% jitter, capped at
`max_reconnect_ms`. A successful connection resets the attempt counter.

### `mqtt`

Subscribes to an MQTT topic over a WebSocket broker and publishes writes back.

| Property | Type | Required | Default | Notes |
| :--- | :--- | :---: | :--- | :--- |
| `type` | `"mqtt"` | ✅ | — | Source discriminator. |
| `url` | string | ✅ | — | Broker URL over WebSocket, `ws://` or `wss://`. |
| `topic` | string | ✅ | — | Subscribed topic, non-empty. |
| `path` | string | ❌ | — | Dot path into the JSON payload, for example `data.temp`. |
| `write_topic` | string | ❌ | `topic` | Publish topic for writes, non-empty. |
| `reconnect_ms` | number | ❌ | `1000` | Initial reconnect delay in milliseconds, `>= 50`. |
| `max_reconnect_ms` | number | ❌ | `30000` | Maximum reconnect delay in milliseconds, `>= 50`. |

`write_topic` defaults to `topic`. Reconnection uses the same exponential
backoff and jitter as `websocket`. Payloads are parsed the same way: objects
are stored directly, primitives become `{ value: <scalar> }`.

### Writing values

`switch` and `slider` widgets call the store write path. The value is delivered
to the source as follows:

| Source | Write behaviour |
| :--- | :--- |
| `mock` | Updates the in-memory value at the bound path; the mock walk continues from the new value. |
| `rest` | Sends `{ "path": "<binding path>", "value": <value> }` as JSON to `write_url` using `write_method`. |
| `websocket` | Sends `{ "path": "<binding path>", "value": <value> }` as JSON over the open socket. |
| `mqtt` | Publishes `{ "path": "<binding path>", "value": <value> }` as JSON to `write_topic`. |

The binding path in the write payload is the part after the source name, for
example `bind: fan.value` sends `path: "value"`. Writes are asynchronous; the
widget shows a pending state until the source confirms the write. If the source
is not connected or rejects the write, the widget reports the error and keeps
the last confirmed value.

---

## Widgets

Every widget accepts the common properties below. `text` is the only widget
that does **not** accept `bind`; it requires `content` instead. Unknown
properties are compile errors.

| Property | Type | Required | Default | Notes |
| :--- | :--- | :---: | :--- | :--- |
| `type` | string | ✅ | — | One of `stat`, `gauge`, `chart`, `status`, `text`, `switch`, `slider`. |
| `title` | string | ❌ | — | Optional widget title. |
| `span` | integer | ❌ | `3` | Width in grid columns, integer from `1` to `12`. |
| `bind` | string | ✅* | — | `<source>.<path>` binding. Required for every widget except `text`. |

The grid is 12 columns wide by default (`app.columns`). A widget with
`span: 6` occupies half of the grid; `span: 12` occupies a full row. If
`app.columns` is smaller than 12, spans are clamped to the configured width at
render time.

### `stat`

A large formatted number with an optional unit.

| Property | Type | Required | Notes |
| :--- | :--- | :---: | :--- |
| `bind` | string | ✅ | Numeric value to display. |
| `unit` | string | ❌ | Displayed unit; falls back to the source `unit` when omitted. |
| `decimals` | number | ❌ | Fixed number of decimal places. |

Supports [`state` / `steps`](#conditions-state-and-steps).

### `gauge`

A semicircular arc with a configurable range.

| Property | Type | Required | Notes |
| :--- | :--- | :---: | :--- |
| `bind` | string | ✅ | Numeric value to display. |
| `min` | number | ❌ | Lower range bound (UI default `0`). |
| `max` | number | ❌ | Upper range bound (UI default `100`). |
| `unit` | string | ❌ | Displayed unit; falls back to the source `unit`. |

If both `min` and `max` are provided, `min` must be smaller than `max`.
Supports [`state` / `steps`](#conditions-state-and-steps).

### `chart`

A line/area history chart. History is kept by the reactive store and grows on
every source emission, even when the value does not change.

| Property | Type | Required | Notes |
| :--- | :--- | :---: | :--- |
| `bind` | string | ✅ | Numeric value to plot. |
| `points` | number | ❌ | Number of history points shown (UI default `60`, minimum effective `2`). |
| `min` | number | ❌ | Fixed lower Y-axis bound (auto-scaled when omitted). |
| `max` | number | ❌ | Fixed upper Y-axis bound (auto-scaled when omitted). |
| `unit` | string | ❌ | Unit shown next to the current value. |

`chart` does not support `state` or `steps`.

### `status`

An on/off indicator with a coloured dot and label. It supports two data modes.

| Property | Type | Required | Notes |
| :--- | :--- | :---: | :--- |
| `bind` | string | ✅ | Value to interpret. |
| `on` | string | ❌ | Label when the value is on (default `"ON"`). |
| `off` | string | ❌ | Label when the value is off (default `"OFF"`). |

- **Numeric data:** when `state` or `steps` is present it takes precedence. The
  matched outcome supplies the label and dot colour. A dot is lit only when the
  outcome includes a `status`.
- **Boolean/string data:** without conditions, values are converted to a
  boolean. `true`, `"true"`, `"on"`, `"1"`, `"yes"`, and non-zero finite
  numbers are on. `false`, `"false"`, `"off"`, `"0"`, `"no"`, and `""` are
  off. Anything else is `unknown` and renders an empty label.

Supports [`state` / `steps`](#conditions-state-and-steps) for numeric data.

### `text`

Static text with no data binding.

| Property | Type | Required | Notes |
| :--- | :--- | :---: | :--- |
| `content` | string | ✅ | Text to render. |

`text` does not accept `bind`, `state`, or `steps`.

### `switch`

An interactive checkbox that writes a boolean to the bound source.

| Property | Type | Required | Notes |
| :--- | :--- | :---: | :--- |
| `bind` | string | ✅ | Boolean (or on/off-compatible) value. |
| `label` | string | ❌ | Label shown next to the checkbox. |

The switch uses the same boolean conversion as `status`. On change it writes
`true` or `false` to the source. Writing is supported by every source type; see
[Writing values](#writing-values). `switch` does not support `state` or
`steps`.

### `slider`

An interactive range input that writes a number to the bound source.

| Property | Type | Required | Notes |
| :--- | :--- | :---: | :--- |
| `bind` | string | ✅ | Numeric value. |
| `min` | number | ❌ | Minimum value (UI default `0`). |
| `max` | number | ❌ | Maximum value (UI default `min + 100`). |
| `step` | number | ❌ | Increment, must be greater than `0` (UI default `1`). |

The displayed value follows the store. On release, the slider writes the new
number to the source. If the value is missing, the slider starts at `min`.
`slider` does not support `state` or `steps`.

---

## Conditions

Conditions map a numeric value to a text label and/or a status colour. They are
supported **only** on `stat`, `gauge`, and `status`. A widget may use **either**
`state` or `steps`, never both. Using conditions on any other widget is a
compile error.

### Outcomes

Every branch of a condition is an outcome. An outcome is either a plain string
(the label) or an object with `text` and/or `status`. At least one of `text` or
`status` must be present, and `text` cannot be empty.

| Field | Type | Notes |
| :--- | :--- | :--- |
| `text` | string | Label shown by the widget. |
| `status` | string | One of `ok`, `info`, `warning`, `danger`. |

### Status levels

| Level | Meaning |
| :--- | :--- |
| `ok` | Healthy / normal. |
| `info` | Informational. |
| `warning` | Needs attention. |
| `danger` | Critical. |

The level is exposed to the UI as `data-status` on the widget card, which themes
can style through the `--m-status` CSS variables.

### `state`

A single inclusive comparison against a threshold.

| Field | Type | Required | Notes |
| :--- | :--- | :---: | :--- |
| `threshold` | number | ✅ | Comparison value. |
| `above` | outcome | ✅* | Used when `value > threshold` (and for equality when `equal` is absent). |
| `below` | outcome | ✅* | Used when `value < threshold`. |
| `equal` | outcome | ❌ | Used when `value === threshold`; falls back to `above` when omitted. |

\* At least one of `above`, `below`, or `equal` is required. If no branch
matches, the widget has no outcome for that value.

```text
value <  threshold  -> below
value === threshold -> equal (or above when equal is omitted)
value >  threshold  -> above
```

### `steps`

An ordered list of thresholds evaluated from highest to lowest.

| Field | Type | Required | Notes |
| :--- | :--- | :---: | :--- |
| `at` | number | ❌ | Inclusive threshold (`value >= at`). Unique per list. |
| `text` | string | ✅* | Label for this step. |
| `status` | string | ✅* | Status colour for this step. |

\* Each step needs at least one of `text` or `status`.

Rules:

- `steps` must be a non-empty list.
- `at` is **inclusive**: a step matches when `value >= at`.
- The matching step with the **largest** `at` wins, regardless of list order.
- `at` values must be unique.
- At most one step may omit `at`. That step is the fallback and is used when no
  numeric step matches. If no fallback exists and no step matches, the widget
  has no outcome.
- Non-numeric values produce no outcome.

### Numeric conditions vs boolean `on`/`off`

`state` and `steps` operate on **numbers**. `on`/`off` on the `status` widget
operate on **booleans and strings**. They are different mechanisms:

- Use `state` / `steps` when the bound value is numeric and you want threshold
  or status-level mapping.
- Use `on` / `off` when the bound value is boolean or a string such as
  `"on"`, `"off"`, `"open"`, or `"closed"`.

On `status`, if both are present, `state` / `steps` take precedence for numeric
values; the boolean `on`/`off` mapping is used only when no outcome matches.

---

## CLI reference

The `@maera/cli` package exposes the `maera` command.

```text
maera dev [file.maera]                    Development server with live reload (default command)
maera build [file.maera] [-o out.html]    Emit one standalone HTML file (default: dist/<name>.html)
maera schema [-o file.json]               Write the JSON Schema for *.maera (default: schema/maera.schema.json)
```

### File resolution

- Pass a file explicitly: `maera dev path/to/dashboard.maera`.
- With no file argument, Maera looks for `index.maera` and then
  `examples/index.maera` in the current directory.
- Only one `.maera` file may be passed to `dev` or `build`.

### `maera dev`

Starts a watcher and local HTTP server, rebuilding and live-reloading on change.

| Option / variable | Default | Notes |
| :--- | :--- | :--- |
| `-h`, `--help` | — | Print usage and exit. |
| `PORT` | `3000` | Starting port; the next 10 ports are tried if busy. |
| `HOST` | `127.0.0.1` | Bind host. |

`-o` is not accepted by `dev`.

### `maera build`

Validates the dashboard with `compile()` before bundling, so a broken file never
produces output. The result is a single self-contained HTML file that can be
opened directly from `file://`.

| Option | Default | Notes |
| :--- | :--- | :--- |
| `-o`, `--out` | `dist/<name>.html` | Output HTML path. |

### `maera schema`

Generates the JSON Schema derived from the core specifications and writes it to
disk. This is the same schema used for editor validation and autocomplete.

| Option | Default | Notes |
| :--- | :--- | :--- |
| `-o`, `--out` | `schema/maera.schema.json` | Output JSON path. |

Individual commands accept `-h` / `--help`. Unknown subcommands, flags, and
extra file arguments are reported as errors.

---

## Editor integration (JSON Schema)

The repository ships `schema/maera.schema.json`. Point your editor's YAML
language server at it to get validation, hover descriptions, and completion for
every key.

VS Code (`settings.json`):

```json
{
  "yaml.schemas": {
    "./schema/maera.schema.json": "*.maera"
  }
}
```

Regenerate the schema after changing core specs:

```bash
maera schema
```

The generated schema is checked in and kept in sync by the test suite, so
documentation examples and editor validation can never drift from the compiler.

---

## Complete examples

### Mock data with conditions

```maera
app:
  title: "Greenhouse"
  theme: "default"
  columns: 12

sources:
  temperature:
    type: mock
    interval: 1000
    min: 18
    max: 38
    unit: "°C"

widgets:
  - type: stat
    title: "Temperature"
    bind: temperature.value
    unit: "°C"
    decimals: 1
    span: 3
    state:
      threshold: 30
      above:
        text: "Hot"
        status: danger
      below:
        text: "Normal"
        status: ok
      equal:
        text: "At limit"
        status: warning

  - type: gauge
    title: "Gauge"
    bind: temperature.value
    min: 0
    max: 50
    unit: "°C"
    span: 3
    steps:
      - at: 33
        text: "Too hot"
        status: danger
      - at: 28
        text: "Warm"
        status: warning
      - text: "Cool"
        status: ok

  - type: chart
    title: "Temperature history"
    bind: temperature.value
    points: 60
    min: 15
    max: 40
    unit: "°C"
    span: 6

  - type: text
    content: "Mock data, no backend required."
    span: 12
```

### Boolean status and two-way controls

```maera
app:
  title: "Controls"
  theme: "dark"
  columns: 12

sources:
  fan:
    type: mock
    interval: 1000
    min: 0
    max: 1
  brightness:
    type: rest
    url: "https://api.example.com/brightness"
    interval: 5000
    headers:
      Authorization: "Bearer token"
    write_url: "https://api.example.com/brightness"
    write_method: PATCH

widgets:
  - type: status
    title: "Fan"
    bind: fan.value
    on: "Running"
    off: "Stopped"
    span: 4

  - type: switch
    title: "Fan power"
    bind: fan.value
    label: "Enable fan"
    span: 4

  - type: slider
    title: "Brightness"
    bind: brightness.value
    min: 0
    max: 100
    step: 5
    span: 4
```

### Real-time sources

```maera
app:
  title: "Realtime"
  theme: "default"
  columns: 12

sources:
  live:
    type: websocket
    url: "wss://example.com/socket"
    path: data.temperature
    reconnect_ms: 500
    max_reconnect_ms: 15000
  broker:
    type: mqtt
    url: "wss://broker.example.com/mqtt"
    topic: "sensors/room1"
    path: data.temperature
    write_topic: "sensors/room1/set"
    reconnect_ms: 1000
    max_reconnect_ms: 30000

widgets:
  - type: status
    title: "WebSocket temperature"
    bind: live.value
    span: 6
    steps:
      - at: 30
        text: "Hot"
        status: danger
      - at: 20
        text: "Warm"
        status: warning
      - text: "Cool"
        status: ok

  - type: status
    title: "MQTT temperature"
    bind: broker.value
    span: 6
    state:
      threshold: 25
      above:
        text: "Above target"
        status: warning
      below:
        text: "On target"
        status: ok
```