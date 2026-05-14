const express = require('express');
const { isDuplicate, getCooldown, setCooldown, acquireLock, releaseLock } = require('../services/deduplicator');
const { analyze } = require('../services/analyzer');
const { trigger } = require('../services/pipeline');
const { fetchWorkItem } = require('../services/workitem');
const logger = require('../lib/logger');

const BASIC_AUTH = Buffer.from(
  `${process.env.WEBHOOK_USER}:${process.env.WEBHOOK_PASSWORD}`
).toString('base64');

const router = express.Router();

router.post('/', async (req, res) => {
  const auth = req.headers['authorization'];
  if (!auth || auth !== `Basic ${BASIC_AUTH}`) {
    logger.warn('Geçersiz kimlik doğrulama', { ip: req.ip });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { eventType, resource } = req.body || {};
  const workItemId = resource?.workItemId || resource?.revision?.id;
  const fields = resource?.fields;

  if (eventType !== 'workitem.updated' || !workItemId || !fields) {
    logger.warn('Geçersiz payload', { eventType, workItemId });
    return res.status(400).json({ error: 'Bad Request' });
  }

  logger.info('Webhook alındı', { workItemId, eventType });

  let workItemFields;
  try {
    workItemFields = await fetchWorkItem(workItemId);
  } catch (err) {
    logger.error('Work item çekilemedi', { workItemId, message: err.message });
    return res.status(500).json({ error: 'Work item fetch failed' });
  }

  const { shouldTrigger, reason, repoName, repoConfig } = analyze(workItemFields);
  if (!shouldTrigger) {
    return res.status(200).json({ status: 'skipped', reason });
  }

  const lockAcquired = await acquireLock(workItemId);
  if (!lockAcquired) {
    logger.info('Lock meşgul, debounced', { workItemId });
    return res.status(200).json({ status: 'debounced', workItemId });
  }

  try {
    const duplicate = await isDuplicate(eventType, workItemId, fields);
    if (duplicate) {
      return res.status(200).json({ status: 'duplicate', workItemId });
    }

    const cooldown = await getCooldown(workItemId);
    if (cooldown) {
      logger.info('Cooldown aktif, atlandı', { workItemId, runId: cooldown.id });
      return res.status(200).json({ status: 'cooldown', workItemId, pipelineRunId: cooldown.id });
    }

    const run = await trigger(workItemId, repoConfig);
    await setCooldown(workItemId, run);
    return res.status(200).json({ status: 'triggered', workItemId, repoName, runId: run.id });
  } catch (err) {
    logger.error('Pipeline tetiklenemedi', { workItemId, message: err.message });
    return res.status(500).json({ error: 'Pipeline trigger failed' });
  } finally {
    await releaseLock(workItemId);
  }
});

module.exports = router;
