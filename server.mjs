import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync.js';
import * as awarenessProtocol from 'y-protocols/awareness.js';
import * as encoding from 'lib0/encoding.js';
import * as decoding from 'lib0/decoding.js';
import fs from 'fs/promises';
import path from 'path';

const PORT = 1234;
const SNAPSHOT_DIR = path.resolve('./snapshots');
await fs.mkdir(SNAPSHOT_DIR, { recursive: true });

const wss = new WebSocketServer({ port: PORT });
const docs = new Map();
const saveTimeouts = new Map();

const messageSync = 0;
const messageAwareness = 1;

// Schedule debounced disk writes (2-second idle window)
function scheduleSnapshotSave(roomname, doc) {
  if (saveTimeouts.has(roomname)) {
    clearTimeout(saveTimeouts.get(roomname));
  }

  const timeout = setTimeout(async () => {
    try {
      const snapshot = Y.encodeStateAsUpdate(doc);
      const targetFile = path.join(SNAPSHOT_DIR, `${roomname}.bin`);
      await fs.writeFile(targetFile, Buffer.from(snapshot));
      console.log(`[Snapshot] Saved room "${roomname}" (${snapshot.byteLength} bytes)`);
    } catch (err) {
      console.error(`[Snapshot Error] Failed to persist "${roomname}":`, err);
    } finally {
      saveTimeouts.delete(roomname);
    }
  }, 2000);

  saveTimeouts.set(roomname, timeout);
}

// Load existing binary snapshot from disk or initialize fresh Y.Doc
async function getYDoc(roomname) {
  let doc = docs.get(roomname);
  if (doc) return doc;

  doc = new Y.Doc();
  doc.conns = new Map();
  doc.awareness = new awarenessProtocol.Awareness(doc);

  const snapshotFile = path.join(SNAPSHOT_DIR, `${roomname}.bin`);
  try {
    const rawData = await fs.readFile(snapshotFile);
    Y.applyUpdate(doc, new Uint8Array(rawData));
    console.log(`[Snapshot] Loaded snapshot for "${roomname}"`);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[Snapshot Error] Could not read "${snapshotFile}":`, err);
    }
  }

  // Hook into document updates to trigger debounced saves
  doc.on('update', () => {
    scheduleSnapshotSave(roomname, doc);
  });

  // Relay awareness changes to all connected peers
  doc.awareness.on('update', ({ added, updated, removed }, origin) => {
    const changedClients = added.concat(updated, removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(doc.awareness, changedClients)
    );
    const message = encoding.toUint8Array(encoder);

    doc.conns.forEach((_, conn) => {
      if (conn !== origin && conn.readyState === 1) {
        conn.send(message);
      }
    });
  });

  docs.set(roomname, doc);
  return doc;
}

wss.on('connection', async (conn, req) => {
  const roomname = req.url.slice(1) || 'default';
  const doc = await getYDoc(roomname);
  doc.conns.set(conn, new Set());

  // 1. Initial Sync Step 1
  const syncEncoder = encoding.createEncoder();
  encoding.writeVarUint(syncEncoder, messageSync);
  syncProtocol.writeSyncStep1(syncEncoder, doc);
  conn.send(encoding.toUint8Array(syncEncoder));

  // 2. Initial Awareness States
  const awarenessStates = doc.awareness.getStates();
  if (awarenessStates.size > 0) {
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, messageAwareness);
    encoding.writeVarUint8Array(
      awarenessEncoder,
      awarenessProtocol.encodeAwarenessUpdate(
        doc.awareness,
        Array.from(awarenessStates.keys())
      )
    );
    conn.send(encoding.toUint8Array(awarenessEncoder));
  }

  conn.on('message', (message) => {
    try {
      const uint8 = new Uint8Array(message);
      const decoder = decoding.createDecoder(uint8);
      const messageType = decoding.readVarUint(decoder);

      if (messageType === messageSync) {
        const replyEncoder = encoding.createEncoder();
        encoding.writeVarUint(replyEncoder, messageSync);
        syncProtocol.readSyncMessage(decoder, replyEncoder, doc, conn);

        if (encoding.length(replyEncoder) > 1) {
          conn.send(encoding.toUint8Array(replyEncoder));
        }

        // Broadcast sync step 2 updates to other clients
        doc.conns.forEach((_, peerConn) => {
          if (peerConn !== conn && peerConn.readyState === 1) {
            const broadcastEncoder = encoding.createEncoder();
            encoding.writeVarUint(broadcastEncoder, messageSync);
            syncProtocol.writeSyncStep2(broadcastEncoder, doc);
            peerConn.send(encoding.toUint8Array(broadcastEncoder));
          }
        });
      } else if (messageType === messageAwareness) {
        // Apply remote ephemeral awareness update and rebroadcast
        awarenessProtocol.applyAwarenessUpdate(
          doc.awareness,
          decoding.readVarUint8Array(decoder),
          conn
        );
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  conn.on('close', () => {
    const controlledClients = doc.conns.get(conn);
    if (controlledClients) {
      doc.conns.delete(conn);
      awarenessProtocol.removeAwarenessStates(
        doc.awareness,
        Array.from(controlledClients),
        null
      );
    }
    if (doc.conns.size === 0) {
      // Force snapshot flush if room is emptied
      scheduleSnapshotSave(roomname, doc);
    }
  });
});

console.log(`Dedicated Yjs Server running on ws://localhost:${PORT}`);