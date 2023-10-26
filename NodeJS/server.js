'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const PORT = 8000;
const HOST = '127.0.0.1';
const EOL = '\r\n';
const UPGRADE = [
  'HTTP/1.1 101 Switching Protocols',
  'Upgrade: websocket',
  'Connection: Upgrade',
].join(EOL);
const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const MASK_LENGTH = 4;
const PING_TIMEOUT = 5000;
const PING = Buffer.from([0x89, 0]);
const OPCODE_SHORT = 0x81;
const LEN_16_BIT = 126;
const LEN_64_BIT = 127;

const acceptKey = (key) => {
  const hash = crypto.createHash('sha1');
  hash.update(key + MAGIC);
  return hash.digest('base64');
};

const calcOffset = (frame, length) => {
  if (length < LEN_16_BIT) return [2, 6];
  if (length === LEN_16_BIT) return [4, 8];
  return [10, 14];
};

const parseFrame = (frame) => {
  const length = frame[1] ^ 0x80;
  const [maskOffset, dataOffset] = calcOffset(frame, length);
  const mask = frame.subarray(maskOffset, maskOffset + MASK_LENGTH);
  const data = frame.subarray(dataOffset);
  return { mask, data };
};

const sendMessage = (socket, text) => {
  const data = Buffer.from(text);
  let meta = Buffer.alloc(2);
  const length = data.length;
  meta[0] = OPCODE_SHORT;
  if (length <= 125) {
    meta[1] = length;
  } else if (length < 65536) {
    const len = Buffer.from([(length & 0xFF00) >> 8, length & 0x00FF]);
    meta = Buffer.concat([meta, len]);
    meta[1] = LEN_16_BIT;
  } else {
    const len = Buffer.alloc(8);
    len.writeBigInt64BE(BigInt(length), 0);
    meta = Buffer.concat([meta, len]);
    meta[1] = LEN_64_BIT;
  }
  const frame = Buffer.concat([meta, data]);
  socket.write(frame);
};

const unmask = (buffer, mask) => {
  const data = Buffer.allocUnsafe(buffer.length);
  buffer.copy(data);
  for (let i = 0; i < data.length; i++) {
    data[i] ^= mask[i & 3];
  }
  return data;
};

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Connect with Websocket');
});

server.on('upgrade', (req, socket, head) => {
  const receive = (data) => {
    if (data[0] !== OPCODE_SHORT) return;
    const frame = parseFrame(data);
    const msg = unmask(frame.data, frame.mask);
    const text = msg.toString();
    sendMessage(socket, `Echo "${text}"`);
    console.log('Message:', text);
  };

  const key = req.headers['sec-websocket-key'];
  const accept = acceptKey(key);
  const packet = UPGRADE + EOL + `Sec-WebSocket-Accept: ${accept}`;
  socket.write(packet + EOL + EOL);
  receive(head);

  socket.on('data', receive);

  socket.on('error', (error) => {
    console.log(error.code);
  });

  setInterval(() => {
    socket.write(PING);
  }, PING_TIMEOUT);
});

server.listen(PORT, HOST);
