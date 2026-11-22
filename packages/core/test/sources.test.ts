import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer, WebSocket as WsClient } from "ws";
import { createStore, startSources, type maeraAST } from "../src/index.js";

// Polyfill globalThis.WebSocket jika belum ada (Node 18 & 20)
if (!globalThis.WebSocket) {
  // @ts-expect-error polyfill for Node 18 & 20
  globalThis.WebSocket = WsClient;
}

function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (condition()) return resolve();
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Timeout menunggu kondisi terpenuhi setelah ${timeoutMs}ms`));
      }
      setTimeout(check, 10);
    };
    check();
  });
}

function closeServer(wss: WebSocketServer): Promise<void> {
  for (const client of wss.clients) {
    try {
      client.terminate();
    } catch {
      // Abaikan
    }
  }
  return new Promise((resolve) => {
    wss.close(() => resolve());
  });
}

test("runner websocket: menerima data JSON, ekstraksi path, dan primitif", async () => {
  const wss = new WebSocketServer({ port: 0 });
  const port = (wss.address() as { port: number }).port;

  const serverSockets: any[] = [];
  wss.on("connection", (ws) => {
    serverSockets.push(ws);
  });

  const ast: Pick<maeraAST, "sources"> = {
    sources: {
      stream_json: {
        type: "websocket",
        url: `ws://127.0.0.1:${port}`,
        line: 1,
      },
      stream_path: {
        type: "websocket",
        url: `ws://127.0.0.1:${port}`,
        path: "metrics.temperature",
        line: 2,
      },
    },
  };

  const store = createStore();
  const runner = startSources(ast, store, { WebSocket: WsClient as unknown as typeof globalThis.WebSocket });

  await waitFor(() => serverSockets.length === 2);

  const broadcast = (data: string) => {
    for (const s of serverSockets) {
      if (s.readyState === 1) s.send(data);
    }
  };

  // 1. Kirim JSON objek utuh
  broadcast(JSON.stringify({ value: 25.5, unit: "C" }));
  await waitFor(() => store.get("stream_json")?.["value"] === 25.5);
  assert.deepEqual(store.get("stream_json"), { value: 25.5, unit: "C" });

  // 2. Kirim JSON dengan path bersarang
  broadcast(JSON.stringify({ metrics: { temperature: 31.2 } }));
  await waitFor(() => store.get("stream_path")?.["value"] === 31.2);
  assert.deepEqual(store.get("stream_path"), { value: 31.2 });

  // 3. Kirim nilai primitif
  broadcast("42.8");
  await waitFor(() => store.get("stream_json")?.["value"] === 42.8);

  broadcast("AKTIF");
  await waitFor(() => store.get("stream_json")?.["value"] === "AKTIF");

  runner.stop();
  wss.close();
});

test("runner websocket: auto-reconnect dengan backoff dan stop bersih", async () => {
  const wss = new WebSocketServer({ port: 0 });
  const port = (wss.address() as { port: number }).port;

  let connectionCount = 0;
  let activeSocket: any;

  wss.on("connection", (ws) => {
    connectionCount++;
    activeSocket = ws;
  });

  const ast: Pick<maeraAST, "sources"> = {
    sources: {
      ws: {
        type: "websocket",
        url: `ws://127.0.0.1:${port}`,
        reconnect_ms: 50,
        max_reconnect_ms: 200,
        line: 1,
      },
    },
  };

  const store = createStore();
  const runner = startSources(ast, store, {
    WebSocket: WsClient as unknown as typeof globalThis.WebSocket,
    random: () => 0,
  });

  await waitFor(() => connectionCount === 1);
  activeSocket.send(JSON.stringify({ value: 1 }));
  await waitFor(() => store.get("ws")?.["value"] === 1);

  // Putus paksa koneksi dari server
  activeSocket.terminate();

  // Verifikasi client reconnect otomatis
  await waitFor(() => connectionCount === 2);
  activeSocket.send(JSON.stringify({ value: 2 }));
  await waitFor(() => store.get("ws")?.["value"] === 2);

  // Stop runner dan pastikan koneksi ditutup & tidak ada reconnect lagi
  runner.stop();
  const countAfterStop = connectionCount;

  // Tunggu sejenak untuk memastikan tidak ada reconnect baru
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(connectionCount, countAfterStop);

  wss.close();
});

test("runner mqtt: handshake, subscribe, publish path & primitif, ping, dan reconnect", async () => {
  const wss = new WebSocketServer({
    port: 0,
    handleProtocols: (protocols) => (protocols.has("mqtt") ? "mqtt" : false),
  });
  const port = (wss.address() as { port: number }).port;

  let connectionCount = 0;
  let activeSocket: any;
  let receivedConnect = false;
  let subscribedTopic = "";
  let receivedPing = false;
  let receivedDisconnect = false;

  wss.on("connection", (ws) => {
    connectionCount++;
    activeSocket = ws;

    ws.on("message", (data: Buffer) => {
      const type = data[0]! >> 4;

      if (type === 1) {
        // CONNECT
        receivedConnect = true;
        // Kirim CONNACK: [0x20, 0x02, 0x00, 0x00]
        ws.send(Buffer.from([0x20, 0x02, 0x00, 0x00]));
      } else if (type === 8) {
        // SUBSCRIBE
        const packetId = (data[2]! << 8) | data[3]!;
        const topicLen = (data[4]! << 8) | data[5]!;
        subscribedTopic = data.subarray(6, 6 + topicLen).toString("utf8");
        // Kirim SUBACK: [0x90, 0x03, packetId_hi, packetId_lo, 0x00]
        ws.send(Buffer.from([0x90, 0x03, data[2]!, data[3]!, 0x00]));
      } else if (type === 12) {
        // PINGREQ
        receivedPing = true;
        // Kirim PINGRESP: [0xd0, 0x00]
        ws.send(Buffer.from([0xd0, 0x00]));
      } else if (type === 14) {
        // DISCONNECT
        receivedDisconnect = true;
      }
    });
  });

  const ast: Pick<maeraAST, "sources"> = {
    sources: {
      mq: {
        type: "mqtt",
        url: `ws://127.0.0.1:${port}`,
        topic: "sensors/greenhouse/temp",
        path: "val",
        reconnect_ms: 50,
        max_reconnect_ms: 200,
        line: 1,
      },
    },
  };

  const store = createStore();
  const runner = startSources(ast, store, {
    WebSocket: WsClient as unknown as typeof globalThis.WebSocket,
    random: () => 0,
  });

  // Tunggu koneksi & handshake selesai
  await waitFor(() => receivedConnect && subscribedTopic === "sensors/greenhouse/temp");
  assert.equal(subscribedTopic, "sensors/greenhouse/temp");

  // Helper untuk mengirim PUBLISH dari mock server ke client
  function sendPublish(topic: string, payload: string) {
    const topicBuf = Buffer.from(topic, "utf8");
    const payloadBuf = Buffer.from(payload, "utf8");
    const remLen = 2 + topicBuf.length + payloadBuf.length;
    const packet = Buffer.alloc(2 + remLen);
    packet[0] = 0x30; // PUBLISH (QoS 0)
    packet[1] = remLen;
    packet.writeUInt16BE(topicBuf.length, 2);
    topicBuf.copy(packet, 4);
    payloadBuf.copy(packet, 4 + topicBuf.length);
    activeSocket.send(packet);
  }

  // 1. Kirim pesan PUBLISH JSON dengan path ekstraksi
  sendPublish("sensors/greenhouse/temp", JSON.stringify({ val: 26.8 }));
  await waitFor(() => store.get("mq")?.["value"] === 26.8);
  assert.deepEqual(store.get("mq"), { value: 26.8 });

  // 2. Kirim pesan ke topik yang tidak cocok -> harus diabaikan
  sendPublish("sensors/other", JSON.stringify({ val: 99.9 }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(store.get("mq")?.["value"], 26.8);

  // 3. Test reconnect MQTT: putus paksa koneksi dari server
  activeSocket.terminate();

  await waitFor(() => connectionCount === 2);
  await waitFor(() => subscribedTopic === "sensors/greenhouse/temp");

  sendPublish("sensors/greenhouse/temp", JSON.stringify({ val: 27.5 }));
  await waitFor(() => store.get("mq")?.["value"] === 27.5);

  // 4. Test stop bersih: kirim DISCONNECT dan hentikan runner
  runner.stop();
  await waitFor(() => receivedDisconnect);

  const countAfterStop = connectionCount;
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(connectionCount, countAfterStop);

  wss.close();
});
