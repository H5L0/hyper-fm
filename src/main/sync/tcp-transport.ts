// ---------------------------------------------------------------------------
// TCP P2P 传输：行分隔 JSON 控制帧 + 紧随其后的二进制载荷
//
// 帧格式：
//   <single line JSON>\n
// 若 JSON 中有 contentLength: N，则随后 N 字节是二进制载荷
//
// 消息：
//   HELLO  { device, version }
//   LIST                                -> SyncManifest (JSON only)
//   GET    { id }                       -> BUNDLE { id, slug, contentLength } + bytes
//   PUT    { id, slug, manifestEntry, contentLength } + bytes -> ACK { ok }
//   ACK    { ok, message? }
//   BYE
// ---------------------------------------------------------------------------

import net from 'node:net';
import { EventEmitter } from 'node:events';
import {
  type KnownDevice,
  type SyncManifest,
  type SyncProjectEntry,
  SYNC_SCHEMA,
} from '../../shared/sync-types.js';
import { FmError } from '../fm-error.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('main:sync:tcp');

// ---------------------------------------------------------------------------
// 消息类型
// ---------------------------------------------------------------------------

export type SyncMessage =
  | { type: 'HELLO'; device: { id: string; name: string }; version: typeof SYNC_SCHEMA }
  | { type: 'LIST' }
  | { type: 'MANIFEST'; manifest: SyncManifest }
  | { type: 'GET'; id: string }
  | { type: 'BUNDLE'; id: string; slug: string; entry: SyncProjectEntry; contentLength: number }
  | { type: 'PUT'; id: string; slug: string; entry: SyncProjectEntry; contentLength: number }
  | { type: 'ACK'; ok: boolean; message?: string }
  | { type: 'BYE' };

// ---------------------------------------------------------------------------
// 帧解析：处理「JSON 行 + 可选二进制载荷」
// ---------------------------------------------------------------------------

class FrameParser extends EventEmitter {
  private buf: Buffer = Buffer.alloc(0);
  private pendingMessage: SyncMessage | null = null;
  private pendingBytes = 0;

  feed(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.tryConsume()) {
      /* loop */
    }
  }

  private tryConsume(): boolean {
    if (this.pendingMessage) {
      if (this.buf.length < this.pendingBytes) return false;
      const payload = this.buf.subarray(0, this.pendingBytes);
      this.buf = this.buf.subarray(this.pendingBytes);
      const msg = this.pendingMessage;
      this.pendingMessage = null;
      this.pendingBytes = 0;
      this.emit('frame', msg, new Uint8Array(payload));
      return true;
    }
    const idx = this.buf.indexOf(0x0a);
    if (idx === -1) return false;
    const line = this.buf.subarray(0, idx).toString('utf-8');
    this.buf = this.buf.subarray(idx + 1);
    let parsed: SyncMessage;
    try {
      parsed = JSON.parse(line) as SyncMessage;
    } catch (err) {
      this.emit('error', new FmError('SYNC_TRANSPORT_FAILED', 'JSON 帧解析失败', err));
      return false;
    }
    const expectsPayload =
      parsed.type === 'BUNDLE' || parsed.type === 'PUT';
    if (expectsPayload) {
      const len = (parsed as { contentLength: number }).contentLength;
      if (len > 0) {
        this.pendingMessage = parsed;
        this.pendingBytes = len;
        return this.buf.length > 0;
      }
    }
    this.emit('frame', parsed, new Uint8Array(0));
    return true;
  }
}

// ---------------------------------------------------------------------------
// 发送
// ---------------------------------------------------------------------------

export function writeFrame(socket: net.Socket, msg: SyncMessage, payload?: Uint8Array): void {
  const line = JSON.stringify(msg) + '\n';
  socket.write(line);
  if (payload && payload.byteLength > 0) {
    socket.write(payload);
  }
}

// ---------------------------------------------------------------------------
// 服务端
// ---------------------------------------------------------------------------

export interface ServerHandlers {
  /** 是否允许该设备连接 */
  isAllowedDevice(device: KnownDevice, endpoint: string): Promise<boolean> | boolean;
  /** 提供本地 manifest（响应 LIST） */
  listManifest(): Promise<SyncManifest>;
  /** 取出指定项目的 zip + entry（响应 GET） */
  getProjectBundle(id: string): Promise<{ entry: SyncProjectEntry; zip: Uint8Array }>;
  /** 接收对端 PUT；relay 模式下应写入 bundleDir */
  acceptProjectBundle(
    fromDevice: { id: string; name: string },
    entry: SyncProjectEntry,
    zip: Uint8Array,
  ): Promise<void>;
}

export interface SyncServer {
  port: number;
  close(): Promise<void>;
}

export function startSyncServer(
  options: { port: number; host?: string },
  handlers: ServerHandlers,
): Promise<SyncServer> {
  return new Promise((resolve, reject) => {
    const server = net.createServer(socket => handleConnection(socket, handlers));
    server.once('error', reject);
    server.listen(options.port, options.host ?? '0.0.0.0', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : options.port;
      logger.info('sync server 已启动', { port });
      resolve({
        port,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close(err => (err ? rej(err) : res()));
          }),
      });
    });
  });
}

async function handleConnection(socket: net.Socket, handlers: ServerHandlers): Promise<void> {
  const endpoint = `${socket.remoteAddress}:${socket.remotePort}`;
  logger.debug('对端连入', { endpoint });
  const parser = new FrameParser();
  let peer: { id: string; name: string } | null = null;
  let allowed = false;

  socket.on('data', chunk => parser.feed(chunk));
  socket.on('error', err => logger.warn('socket error', { endpoint, message: err.message }));

  parser.on('error', (err: Error) => {
    logger.warn('解析失败，断开连接', { endpoint, message: err.message });
    socket.destroy();
  });

  parser.on('frame', async (msg: SyncMessage, payload: Uint8Array) => {
    try {
      if (!peer) {
        if (msg.type !== 'HELLO') {
          writeFrame(socket, { type: 'ACK', ok: false, message: '需要先发送 HELLO' });
          socket.end();
          return;
        }
        peer = msg.device;
        allowed = await handlers.isAllowedDevice(
          { id: peer.id, name: peer.name, lastEndpoint: endpoint },
          endpoint,
        );
        if (!allowed) {
          writeFrame(socket, { type: 'ACK', ok: false, message: '设备未授权' });
          socket.end();
          return;
        }
        writeFrame(socket, { type: 'ACK', ok: true });
        return;
      }
      switch (msg.type) {
        case 'LIST': {
          const manifest = await handlers.listManifest();
          writeFrame(socket, { type: 'MANIFEST', manifest });
          break;
        }
        case 'GET': {
          const { entry, zip } = await handlers.getProjectBundle(msg.id);
          writeFrame(
            socket,
            { type: 'BUNDLE', id: entry.id, slug: entry.slug, entry, contentLength: zip.byteLength },
            zip,
          );
          break;
        }
        case 'PUT': {
          await handlers.acceptProjectBundle(peer, msg.entry, payload);
          writeFrame(socket, { type: 'ACK', ok: true });
          break;
        }
        case 'BYE': {
          socket.end();
          break;
        }
        default:
          writeFrame(socket, { type: 'ACK', ok: false, message: `不支持的消息类型 ${msg.type}` });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeFrame(socket, { type: 'ACK', ok: false, message });
      logger.warn('处理消息失败', { endpoint, message });
    }
  });
}

// ---------------------------------------------------------------------------
// 客户端
// ---------------------------------------------------------------------------

export interface SyncClient {
  hello(device: { id: string; name: string }): Promise<void>;
  list(): Promise<SyncManifest>;
  get(id: string): Promise<{ entry: SyncProjectEntry; zip: Uint8Array }>;
  put(entry: SyncProjectEntry, zip: Uint8Array): Promise<void>;
  bye(): Promise<void>;
  close(): void;
}

export function connectSyncClient(host: string, port: number): Promise<SyncClient> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const parser = new FrameParser();
    socket.once('connect', () => resolve(makeClient(socket, parser)));
    socket.once('error', err => reject(new FmError('SYNC_TRANSPORT_FAILED', `连接失败 ${host}:${port}`, err)));
    socket.on('data', chunk => parser.feed(chunk));
  });
}

function makeClient(socket: net.Socket, parser: FrameParser): SyncClient {
  const queue: Array<{
    resolve: (value: { msg: SyncMessage; payload: Uint8Array }) => void;
    reject: (err: Error) => void;
  }> = [];

  parser.on('frame', (msg: SyncMessage, payload: Uint8Array) => {
    const next = queue.shift();
    if (next) next.resolve({ msg, payload });
  });
  parser.on('error', err => {
    while (queue.length) queue.shift()!.reject(err as Error);
    socket.destroy();
  });
  socket.on('close', () => {
    while (queue.length) queue.shift()!.reject(new FmError('SYNC_TRANSPORT_FAILED', '连接已关闭'));
  });

  function nextFrame(): Promise<{ msg: SyncMessage; payload: Uint8Array }> {
    return new Promise((resolve, reject) => queue.push({ resolve, reject }));
  }

  return {
    async hello(device) {
      writeFrame(socket, { type: 'HELLO', device, version: SYNC_SCHEMA });
      const { msg } = await nextFrame();
      if (msg.type !== 'ACK' || !msg.ok) {
        throw new FmError('SYNC_DEVICE_UNKNOWN', msg.type === 'ACK' ? msg.message ?? 'HELLO 被拒绝' : 'HELLO 异常响应');
      }
    },
    async list() {
      writeFrame(socket, { type: 'LIST' });
      const { msg } = await nextFrame();
      if (msg.type !== 'MANIFEST') {
        throw new FmError('SYNC_TRANSPORT_FAILED', `LIST 异常响应：${msg.type}`);
      }
      return msg.manifest;
    },
    async get(id) {
      writeFrame(socket, { type: 'GET', id });
      const { msg, payload } = await nextFrame();
      if (msg.type !== 'BUNDLE') {
        throw new FmError('SYNC_TRANSPORT_FAILED', `GET 异常响应：${msg.type}`);
      }
      return { entry: msg.entry, zip: payload };
    },
    async put(entry, zip) {
      writeFrame(
        socket,
        { type: 'PUT', id: entry.id, slug: entry.slug, entry, contentLength: zip.byteLength },
        zip,
      );
      const { msg } = await nextFrame();
      if (msg.type !== 'ACK' || !msg.ok) {
        throw new FmError('SYNC_TRANSPORT_FAILED', msg.type === 'ACK' ? msg.message ?? 'PUT 被拒绝' : 'PUT 异常响应');
      }
    },
    async bye() {
      writeFrame(socket, { type: 'BYE' });
      socket.end();
    },
    close() {
      socket.destroy();
    },
  };
}
