// 企业微信回调加解密（WXBizMsgCrypt 兼容实现）
// 参考企业微信官方算法：SHA1 签名校验 + AES-256-CBC 加解密 + PKCS7 填充
// 文档: https://developer.work.weixin.qq.com/document/path/90968

import crypto from 'node:crypto';

/**
 * 校验回调签名。
 * 企业微信回调 URL 验证与事件推送均带 msg_signature，
 * 签名 = SHA1(sort(token, timestamp, nonce, encrypt_msg))
 */
export function verifyWecomSignature(params: {
  token: string;
  timestamp: string;
  nonce: string;
  encryptMsg: string;
  msgSignature: string;
}): boolean {
  const { token, timestamp, nonce, encryptMsg, msgSignature } = params;
  const str = [token, timestamp, nonce, encryptMsg].sort().join('');
  const hash = crypto.createHash('sha1').update(str).digest('hex');
  return hash === msgSignature;
}

/** EncodingAESKey（43 位）→ AES-256-CBC 的 key（32 字节）与 iv（前 16 字节） */
function deriveKeyIv(encodingAesKey: string): { key: Buffer; iv: Buffer } {
  const key = Buffer.from(encodingAesKey + '=', 'base64');
  if (key.length !== 32) {
    throw new Error('EncodingAESKey 无效（解码后必须为 32 字节）');
  }
  return { key, iv: key.subarray(0, 16) };
}

/** AES-CBC 解密（PKCS7 去填充） */
function aesDecrypt(encrypted: Buffer, key: Buffer, iv: Buffer): Buffer {
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  // PKCS7 unpad
  const padLen = decrypted[decrypted.length - 1];
  if (padLen < 1 || padLen > 32) throw new Error('PKCS7 填充无效');
  return decrypted.subarray(0, decrypted.length - padLen);
}

/**
 * 解密回调密文。
 * 明文结构: random(16 字节) + msg_len(4 字节网络序) + msg + receiveid(corpid)
 */
export function decryptWecomMsg(
  encryptedBase64: string,
  encodingAesKey: string,
  receiveId: string,
): { message: string; receiveId: string } {
  const { key, iv } = deriveKeyIv(encodingAesKey);
  const decrypted = aesDecrypt(Buffer.from(encryptedBase64, 'base64'), key, iv);
  // 跳过 16 字节 random
  const msgLen = decrypted.readUInt32BE(16);
  const message = decrypted.subarray(20, 20 + msgLen).toString('utf8');
  const rid = decrypted.subarray(20 + msgLen).toString('utf8');
  return { message, receiveId: rid };
}

/**
 * 加密明文（用于 URL 验证回包 / 回复消息）。
 * 明文结构: random(16) + msg_len(4) + msg + receiveid
 */
export function encryptWecomMsg(
  plainText: string,
  encodingAesKey: string,
  receiveId: string,
): string {
  const { key, iv } = deriveKeyIv(encodingAesKey);
  const random = crypto.randomBytes(16);
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(Buffer.byteLength(plainText), 0);
  const raw = Buffer.concat([
    random,
    lenBuf,
    Buffer.from(plainText, 'utf8'),
    Buffer.from(receiveId, 'utf8'),
  ]);
  // PKCS7 pad to 32-byte blocks
  const blockSize = 32;
  const padLen = blockSize - (raw.length % blockSize);
  const padded = Buffer.concat([raw, Buffer.alloc(padLen, padLen)]);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
  return encrypted.toString('base64');
}

/** 生成 msg_signature（用于主动回复消息给企业微信服务器时拼接 URL 参数） */
export function buildWecomMsgSignature(params: {
  token: string;
  timestamp: string;
  nonce: string;
  encryptMsg: string;
}): string {
  const { token, timestamp, nonce, encryptMsg } = params;
  const str = [token, timestamp, nonce, encryptMsg].sort().join('');
  return crypto.createHash('sha1').update(str).digest('hex');
}
