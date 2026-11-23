import { readPath, type Store } from "./store.js";
import type {
  maeraAST,
  MockSource,
  MqttSource,
  RestSource,
  SourceData,
  WebSocketSource,
} from "./types.js";

export interface SourceRunnerOptions {
  /** Implementasi fetch; default `globalThis.fetch` */
  fetch?: typeof globalThis.fetch;
  /** Implementasi WebSocket; default `globalThis.WebSocket` */
  WebSocket?: typeof globalThis.WebSocket;
  /** Generator acak 0..1; default `Math.random` (ganti untuk tes deterministik) */
  random?: () => number;
  /** Dipanggil saat polling `rest` atau koneksi real-time gagal. Runner tetap lanjut. */
  onError?: (source: string, error: unknown) => void;
}

export interface SourceRunner {
  /** Hentikan semua timer dan batalkan koneksi/request yang sedang berjalan. */
  stop(): void;
}

/** Jalankan semua source di AST dan dorong datanya ke store. */
export function startSources(
  ast: Pick<maeraAST, "sources">,
  store: Store,
  opts: SourceRunnerOptions = {},
): SourceRunner {
  const stoppers: Array<() => void> = [];
  for (const [name, def] of Object.entries(ast.sources)) {
    if (def.type === "mock") {
      stoppers.push(runMock(name, def, store, opts));
    } else if (def.type === "rest") {
      stoppers.push(runRest(name, def, store, opts));
    } else if (def.type === "websocket") {
      stoppers.push(runWebSocket(name, def, store, opts));
    } else if (def.type === "mqtt") {
      stoppers.push(runMqtt(name, def, store, opts));
    }
  }
  return { stop: () => stoppers.forEach((s) => s()) };
}

function setPath(
  data: SourceData | undefined,
  path: readonly string[],
  value: unknown,
): SourceData {
  const root: SourceData = data ? { ...data } : {};
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    const next = cur[key];
    cur[key] =
      next !== null && typeof next === "object" && !Array.isArray(next)
        ? { ...(next as Record<string, unknown>) }
        : {};
    cur = cur[key] as Record<string, unknown>;
  }
  const leaf = path[path.length - 1];
  if (leaf !== undefined) cur[leaf] = value;
  return root;
}

/** Random walk di dalam [min, max]; emisi pertama langsung terjadi. */
function runMock(
  name: string,
  def: MockSource,
  store: Store,
  opts: SourceRunnerOptions,
): () => void {
  const rnd = opts.random ?? Math.random;
  const span = def.max - def.min;
  let value = def.min + span * (0.3 + rnd() * 0.4);

  const tick = () => {
    value += (rnd() - 0.5) * span * 0.1;
    value = Math.min(def.max, Math.max(def.min, value));
    const data: SourceData = { value: Math.round(value * 100) / 100 };
    if (def.unit) data["unit"] = def.unit;
    store.set(name, data);
  };

  const unregisterWriter = store.registerWriter(name, (binding, val) => {
    const next = setPath(store.get(name), binding.p, val);
    if (
      binding.p.length === 1 &&
      binding.p[0] === "value" &&
      typeof val === "number"
    ) {
      value = val;
    }
    store.set(name, next);
  });

  tick();
  const id = setInterval(tick, def.interval);
  return () => {
    clearInterval(id);
    unregisterWriter();
  };
}

/** Polling GET berurutan (tanpa request tumpang-tindih). */
function runRest(
  name: string,
  def: RestSource,
  store: Store,
  opts: SourceRunnerOptions,
): () => void {
  const doFetch = opts.fetch ?? globalThis.fetch;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ctrl: AbortController | undefined;

  const poll = async () => {
    ctrl = new AbortController();
    try {
      const res = await doFetch(def.url, {
        method: "GET",
        headers: def.headers ?? {},
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} dari ${def.url}`);
      const json: unknown = await res.json();
      const picked = def.path ? readPath(json, def.path.split(".")) : json;
      if (picked === undefined)
        throw new Error(`Jalur '${def.path}' tidak ditemukan pada respons.`);
      const data: SourceData =
        picked !== null && typeof picked === "object" && !Array.isArray(picked)
          ? (picked as SourceData)
          : { value: picked };
      if (!stopped) store.set(name, data);
    } catch (e) {
      if (!stopped) opts.onError?.(name, e);
    } finally {
      if (!stopped) timer = setTimeout(poll, def.interval);
    }
  };

  const unregisterWriter = store.registerWriter(name, async (binding, val) => {
    if (stopped) {
      throw new Error(`Source REST '${name}' sudah dihentikan.`);
    }
    const targetUrl = def.write_url ?? def.url;
    const method = (def.write_method ?? "POST").toUpperCase();
    const res = await doFetch(targetUrl, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(def.headers ?? {}),
      },
      body: JSON.stringify({ path: binding.p.join("."), value: val }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} dari ${targetUrl}`);
  });

  void poll();
  return () => {
    stopped = true;
    unregisterWriter();
    if (timer) clearTimeout(timer);
    ctrl?.abort();
  };
}

/** Parse payload teks (JSON atau nilai primitif) dan terapkan ekstraksi path. */
function parseMessageData(raw: string, path?: string): SourceData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw;
  }
  const picked = path ? readPath(parsed, path.split(".")) : parsed;
  if (path !== undefined && picked === undefined) {
    throw new Error(`Jalur '${path}' tidak ditemukan pada pesan.`);
  }
  if (picked !== null && typeof picked === "object" && !Array.isArray(picked)) {
    return picked as SourceData;
  }
  return { value: picked };
}

/** Hitung durasi backoff eksponensial dengan jitter. */
function calculateBackoff(
  attempt: number,
  baseMs: number,
  maxMs: number,
  rnd: () => number,
): number {
  const base = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  const jitter = base * 0.1 * rnd();
  return Math.min(maxMs, Math.round(base + jitter));
}

/** Runner real-time WebSocket murni. */
function runWebSocket(
  name: string,
  def: WebSocketSource,
  store: Store,
  opts: SourceRunnerOptions,
): () => void {
  const WsClass = opts.WebSocket ?? globalThis.WebSocket;
  let stopped = false;
  let currentWs: WebSocket | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;

  const rnd = opts.random ?? Math.random;
  const baseDelay = def.reconnect_ms ?? 1000;
  const maxDelay = def.max_reconnect_ms ?? 30000;

  const connect = () => {
    if (stopped) return;
    if (!WsClass) {
      opts.onError?.(name, new Error("Konstruktor WebSocket tidak tersedia."));
      return;
    }

    let closed = false;
    let ws: WebSocket;
    try {
      ws = new WsClass(def.url);
    } catch (e) {
      if (!stopped) {
        opts.onError?.(name, e);
        scheduleReconnect();
      }
      return;
    }
    currentWs = ws;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (currentWs === ws) {
        currentWs = undefined;
      }
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = () => {};
      ws.onmessage = null;
    };

    const handleDisconnect = (err?: unknown) => {
      if (closed) return;
      cleanup();
      if (stopped) return;
      if (err) {
        opts.onError?.(name, err);
      }
      scheduleReconnect();
    };

    ws.onopen = () => {
      attempt = 0;
    };

    ws.onmessage = (event: MessageEvent) => {
      if (stopped) return;
      try {
        let raw: string;
        if (typeof event.data === "string") {
          raw = event.data;
        } else if (event.data instanceof ArrayBuffer) {
          raw = new TextDecoder().decode(new Uint8Array(event.data));
        } else if (ArrayBuffer.isView(event.data)) {
          const v = event.data;
          raw = new TextDecoder().decode(
            new Uint8Array(v.buffer as ArrayBuffer, v.byteOffset, v.byteLength),
          );
        } else {
          raw = String(event.data);
        }

        const data = parseMessageData(raw, def.path);
        if (!stopped) store.set(name, data);
      } catch (e) {
        if (!stopped) opts.onError?.(name, e);
      }
    };

    ws.onerror = () => {
      handleDisconnect(new Error(`WebSocket error pada ${def.url}`));
    };

    ws.onclose = () => {
      handleDisconnect();
    };
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer !== undefined) return;
    const delay = calculateBackoff(attempt, baseDelay, maxDelay, rnd);
    attempt++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, delay);
  };

  const unregisterWriter = store.registerWriter(name, async (binding, val) => {
    if (stopped || !currentWs || currentWs.readyState !== 1) {
      throw new Error(`WebSocket '${name}' belum terhubung.`);
    }
    currentWs.send(JSON.stringify({ path: binding.p.join("."), value: val }));
  });

  connect();

  return () => {
    stopped = true;
    unregisterWriter();
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
    if (currentWs) {
      currentWs.onopen = null;
      currentWs.onclose = null;
      currentWs.onerror = () => {};
      currentWs.onmessage = null;
      try {
        currentWs.close();
      } catch {
        // Abaikan error saat menutup koneksi
      }
      currentWs = undefined;
    }
  };
}

// ── MQTT 3.1.1 Over WebSocket ─────────────────────────────────────

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function encodeRemainingLength(length: number): number[] {
  const bytes: number[] = [];
  do {
    let encodedByte = length % 128;
    length = Math.floor(length / 128);
    if (length > 0) {
      encodedByte |= 128;
    }
    bytes.push(encodedByte);
  } while (length > 0);
  return bytes;
}

function decodeRemainingLength(
  buf: Uint8Array,
  offset: number,
): { length: number; bytesRead: number } {
  let multiplier = 1;
  let value = 0;
  let bytesRead = 0;
  let encodedByte: number;
  do {
    if (offset + bytesRead >= buf.length) {
      throw new Error("Panjang tersisa tidak lengkap");
    }
    encodedByte = buf[offset + bytesRead]!;
    value += (encodedByte & 127) * multiplier;
    multiplier *= 128;
    bytesRead++;
    if (multiplier > 128 * 128 * 128) {
      throw new Error("Panjang tersisa MQTT melebihi batas 4 byte");
    }
  } while ((encodedByte & 128) !== 0);
  return { length: value, bytesRead };
}

function encodeUtf8String(str: string): Uint8Array {
  const strBytes = textEncoder.encode(str);
  const out = new Uint8Array(2 + strBytes.length);
  out[0] = (strBytes.length >> 8) & 0xff;
  out[1] = strBytes.length & 0xff;
  out.set(strBytes, 2);
  return out;
}

function buildConnectPacket(clientId: string, keepAliveSec: number = 60): Uint8Array {
  const protoName = encodeUtf8String("MQTT");
  const protoLevel = 4; // MQTT 3.1.1
  const connectFlags = 0x02; // Clean session
  const keepAliveHigh = (keepAliveSec >> 8) & 0xff;
  const keepAliveLow = keepAliveSec & 0xff;

  const clientIdBytes = encodeUtf8String(clientId);
  const varHeaderLen = protoName.length + 1 + 1 + 2;
  const payloadLen = clientIdBytes.length;
  const remLen = varHeaderLen + payloadLen;

  const remLenBytes = encodeRemainingLength(remLen);
  const packet = new Uint8Array(1 + remLenBytes.length + remLen);

  let offset = 0;
  packet[offset++] = 0x10; // CONNECT
  packet.set(remLenBytes, offset);
  offset += remLenBytes.length;

  packet.set(protoName, offset);
  offset += protoName.length;

  packet[offset++] = protoLevel;
  packet[offset++] = connectFlags;
  packet[offset++] = keepAliveHigh;
  packet[offset++] = keepAliveLow;

  packet.set(clientIdBytes, offset);
  return packet;
}

function buildSubscribePacket(topic: string, packetId: number = 1): Uint8Array {
  const topicBytes = encodeUtf8String(topic);
  const remLen = 2 + topicBytes.length + 1;
  const remLenBytes = encodeRemainingLength(remLen);

  const packet = new Uint8Array(1 + remLenBytes.length + remLen);
  let offset = 0;
  packet[offset++] = 0x82; // SUBSCRIBE (QoS 1 wire format flag)
  packet.set(remLenBytes, offset);
  offset += remLenBytes.length;

  packet[offset++] = (packetId >> 8) & 0xff;
  packet[offset++] = packetId & 0xff;

  packet.set(topicBytes, offset);
  offset += topicBytes.length;

  packet[offset++] = 0x00; // Requested QoS 0
  return packet;
}

function buildPubackPacket(packetId: number): Uint8Array {
  return new Uint8Array([0x40, 0x02, (packetId >> 8) & 0xff, packetId & 0xff]);
}

function buildPublishPacket(topic: string, payload: string): Uint8Array {
  const topicBytes = encodeUtf8String(topic);
  const payloadBytes = textEncoder.encode(payload);
  const remLen = topicBytes.length + payloadBytes.length;
  const remLenBytes = encodeRemainingLength(remLen);
  const packet = new Uint8Array(1 + remLenBytes.length + remLen);

  let offset = 0;
  packet[offset++] = 0x30; // PUBLISH (QoS 0)
  packet.set(remLenBytes, offset);
  offset += remLenBytes.length;
  packet.set(topicBytes, offset);
  offset += topicBytes.length;
  packet.set(payloadBytes, offset);
  return packet;
}

const PINGREQ_PACKET = new Uint8Array([0xc0, 0x00]);
const DISCONNECT_PACKET = new Uint8Array([0xe0, 0x00]);

function topicMatches(filter: string, topic: string): boolean {
  if (filter === topic || filter === "#") return true;
  const filterParts = filter.split("/");
  const topicParts = topic.split("/");
  for (let i = 0; i < filterParts.length; i++) {
    const f = filterParts[i]!;
    if (f === "#") return true;
    if (f !== "+" && f !== topicParts[i]) return false;
  }
  return filterParts.length === topicParts.length;
}

/** Runner real-time MQTT 3.1.1 over WebSocket. */
function runMqtt(
  name: string,
  def: MqttSource,
  store: Store,
  opts: SourceRunnerOptions,
): () => void {
  const WsClass = opts.WebSocket ?? globalThis.WebSocket;
  let stopped = false;
  let connected = false;
  let currentWs: WebSocket | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let attempt = 0;
  let packetIdCounter = 1;

  const rnd = opts.random ?? Math.random;
  const baseDelay = def.reconnect_ms ?? 1000;
  const maxDelay = def.max_reconnect_ms ?? 30000;

  const connect = () => {
    if (stopped) return;
    if (!WsClass) {
      opts.onError?.(name, new Error("Konstruktor WebSocket tidak tersedia."));
      return;
    }

    let closed = false;
    let ws: WebSocket;
    try {
      ws = new WsClass(def.url, "mqtt");
      ws.binaryType = "arraybuffer";
    } catch (e) {
      if (!stopped) {
        opts.onError?.(name, e);
        scheduleReconnect();
      }
      return;
    }
    currentWs = ws;

    let buffer: Uint8Array<any> = new Uint8Array(0);

    const cleanup = () => {
      if (closed) return;
      closed = true;
      connected = false;
      if (pingTimer !== undefined) {
        clearInterval(pingTimer);
        pingTimer = undefined;
      }
      if (currentWs === ws) {
        currentWs = undefined;
      }
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = () => {};
      ws.onmessage = null;
    };

    const handleDisconnect = (err?: unknown) => {
      if (closed) return;
      cleanup();
      if (stopped) return;
      if (err) {
        opts.onError?.(name, err);
      }
      scheduleReconnect();
    };

    ws.onopen = () => {
      const clientId = `maera_${rnd().toString(36).slice(2, 10)}`;
      try {
        ws.send(buildConnectPacket(clientId, 60));
      } catch (e) {
        handleDisconnect(e);
      }
    };

    ws.onmessage = (event: MessageEvent) => {
      if (stopped) return;
      let newBytes: Uint8Array;
      if (event.data instanceof ArrayBuffer) {
        newBytes = new Uint8Array(event.data);
      } else if (ArrayBuffer.isView(event.data)) {
        const v = event.data;
        newBytes = new Uint8Array(
          v.buffer as unknown as ArrayBuffer,
          v.byteOffset,
          v.byteLength,
        ) as unknown as Uint8Array;
      } else {
        newBytes = textEncoder.encode(String(event.data));
      }

      if (buffer.length === 0) {
        buffer = newBytes;
      } else {
        const merged = new Uint8Array(buffer.length + newBytes.length);
        merged.set(buffer, 0);
        merged.set(newBytes, buffer.length);
        buffer = merged;
      }

      let offset = 0;
      while (offset < buffer.length) {
        const byte1 = buffer[offset]!;
        const packetType = byte1 >> 4;
        const flags = byte1 & 0x0f;

        let remLenRes;
        try {
          remLenRes = decodeRemainingLength(buffer, offset + 1);
        } catch {
          break;
        }

        const packetHeaderLen = 1 + remLenRes.bytesRead;
        const totalPacketLen = packetHeaderLen + remLenRes.length;

        if (offset + totalPacketLen > buffer.length) {
          break;
        }

        const body = buffer.subarray(
          offset + packetHeaderLen,
          offset + totalPacketLen,
        );
        offset += totalPacketLen;

        handlePacket(packetType, flags, body);
      }

      buffer = buffer.subarray(offset);
    };

    const handlePacket = (packetType: number, flags: number, body: Uint8Array) => {
      if (stopped) return;

      if (packetType === 2) {
        // CONNACK
        const returnCode = body.length > 1 ? body[1] : -1;
        if (returnCode !== 0) {
          handleDisconnect(
            new Error(`Koneksi MQTT ditolak dengan kode ${returnCode}`),
          );
          return;
        }

        connected = true;
        attempt = 0;
        packetIdCounter = (packetIdCounter % 65535) + 1;
        try {
          ws.send(buildSubscribePacket(def.topic, packetIdCounter));
        } catch (e) {
          handleDisconnect(e);
          return;
        }

        // Mulai ping keep-alive berkala (setiap 30 detik)
        if (pingTimer !== undefined) clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          if (ws.readyState === 1) {
            try {
              ws.send(PINGREQ_PACKET);
            } catch {
              // Diabaikan; error ditangani oleh onclose/onerror
            }
          }
        }, 30000);
      } else if (packetType === 3) {
        // PUBLISH
        if (body.length < 2) return;
        const topicLen = (body[0]! << 8) | body[1]!;
        if (body.length < 2 + topicLen) return;
        const topic = textDecoder.decode(body.subarray(2, 2 + topicLen));
        let pos = 2 + topicLen;
        const qos = (flags >> 1) & 0x03;
        let packetId: number | undefined;
        if (qos > 0) {
          if (body.length < pos + 2) return;
          packetId = (body[pos]! << 8) | body[pos + 1]!;
          pos += 2;
        }

        if (topicMatches(def.topic, topic)) {
          const payloadStr = textDecoder.decode(body.subarray(pos));
          try {
            const data = parseMessageData(payloadStr, def.path);
            if (!stopped) store.set(name, data);
          } catch (e) {
            if (!stopped) opts.onError?.(name, e);
          }
        }

        if (qos === 1 && packetId !== undefined && ws.readyState === 1) {
          try {
            ws.send(buildPubackPacket(packetId));
          } catch {
            // Abaikan
          }
        }
      } else if (packetType === 9) {
        // SUBACK
        if (body.length > 2 && body[2]! >= 0x80) {
          opts.onError?.(
            name,
            new Error(`Subscribe MQTT gagal dengan kode ${body[2]}`),
          );
        }
      }
      // PINGRESP (13) diakui tanpa aksi tambahan
    };

    ws.onerror = () => {
      handleDisconnect(new Error(`WebSocket error pada ${def.url}`));
    };

    ws.onclose = () => {
      handleDisconnect();
    };
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer !== undefined) return;
    const delay = calculateBackoff(attempt, baseDelay, maxDelay, rnd);
    attempt++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, delay);
  };

  const unregisterWriter = store.registerWriter(name, async (binding, val) => {
    if (stopped || !currentWs || currentWs.readyState !== 1 || !connected) {
      throw new Error(`MQTT '${name}' belum terhubung.`);
    }
    const targetTopic = def.write_topic ?? def.topic;
    const payload = JSON.stringify({ path: binding.p.join("."), value: val });
    currentWs.send(buildPublishPacket(targetTopic, payload));
  });

  connect();

  return () => {
    stopped = true;
    connected = false;
    unregisterWriter();
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
    if (pingTimer !== undefined) {
      clearInterval(pingTimer);
      pingTimer = undefined;
    }
    if (currentWs) {
      currentWs.onopen = null;
      currentWs.onclose = null;
      currentWs.onerror = () => {};
      currentWs.onmessage = null;
      try {
        if (currentWs.readyState === 1) {
          currentWs.send(DISCONNECT_PACKET);
        }
        currentWs.close();
      } catch {
        // Abaikan
      }
      currentWs = undefined;
    }
  };
}
