const crypto = require('crypto');
const redis = require('../lib/redis');
const logger = require('../lib/logger');

const DUPLICATE_TTL = Number(process.env.WEBHOOK_DUPLICATE_WINDOW_SECONDS) || 120;
const COOLDOWN_TTL = Number(process.env.WEBHOOK_COOLDOWN_SECONDS) || 180;
const LOCK_TTL = 15;

function buildDuplicateKey(eventType, workItemId, fields) {
  const assignedToOld = fields['System.AssignedTo']?.oldValue || '';
  const assignedToNew = fields['System.AssignedTo']?.newValue || '';
  const titleOld = fields['System.Title']?.oldValue || '';
  const titleNew = fields['System.Title']?.newValue || '';
  const fingerprint = [eventType, workItemId, assignedToOld, assignedToNew, titleOld, titleNew].join('|');
  const hash = crypto.createHash('sha256').update(fingerprint).digest('hex');
  return `ado:webhook:duplicate:${hash}`;
}

function buildCooldownKey(workItemId) {
  return `ado:webhook:cooldown:${workItemId}`;
}

function buildLockKey(workItemId) {
  return `ado:webhook:lock:${workItemId}`;
}

async function acquireLock(workItemId) {
  const key = buildLockKey(workItemId);
  try {
    const result = await redis.set(key, '1', 'NX', 'EX', LOCK_TTL);
    return result === 'OK';
  } catch (err) {
    logger.warn('Redis lock hatası', { workItemId, message: err.message });
    return true; // fail-open
  }
}

async function releaseLock(workItemId) {
  try {
    await redis.del(buildLockKey(workItemId));
  } catch (err) {
    logger.warn('Redis lock release hatası', { workItemId, message: err.message });
  }
}

async function isDuplicate(eventType, workItemId, fields) {
  const key = buildDuplicateKey(eventType, workItemId, fields);
  try {
    const result = await redis.set(key, '1', 'NX', 'EX', DUPLICATE_TTL);
    if (result === null) {
      logger.info('Duplicate atlandı', { workItemId, key });
      return true;
    }
    return false;
  } catch (err) {
    logger.warn('Redis hatası, duplicate kontrolü atlandı', { workItemId, message: err.message });
    return false;
  }
}

async function getCooldown(workItemId) {
  const key = buildCooldownKey(workItemId);
  try {
    const value = await redis.get(key);
    return value ? JSON.parse(value) : null;
  } catch (err) {
    logger.warn('Redis cooldown okuma hatası', { workItemId, message: err.message });
    return null;
  }
}

async function setCooldown(workItemId, runData) {
  const key = buildCooldownKey(workItemId);
  try {
    await redis.set(key, JSON.stringify(runData), 'EX', COOLDOWN_TTL);
  } catch (err) {
    logger.warn('Redis cooldown yazma hatası', { workItemId, message: err.message });
  }
}

module.exports = { isDuplicate, getCooldown, setCooldown, acquireLock, releaseLock };
