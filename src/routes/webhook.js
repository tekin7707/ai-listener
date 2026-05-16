const express = require('express');
const { isDuplicate, getCooldown, setCooldown, acquireLock, releaseLock } = require('../services/deduplicator');
const { analyze } = require('../services/analyzer');
const { trigger } = require('../services/pipeline');
const { fetchWorkItem } = require('../services/workitem');
const logger = require('../lib/logger');
const { t } = require('../lib/i18n');

const BASIC_AUTH = Buffer.from(
  `${process.env.WEBHOOK_USER}:${process.env.WEBHOOK_PASSWORD}`
).toString('base64');

const router = express.Router();

router.post('/', async (req, res) => {
  const auth = req.headers['authorization'];
  if (!auth || auth !== `Basic ${BASIC_AUTH}`) {
    logger.warn(t('webhook.log_unauthorized'), { ip: req.ip });
    return res.status(401).json({ error: t('webhook.err_unauthorized') });
  }

  const { eventType, resource } = req.body || {};
  const workItemId = resource?.workItemId || resource?.revision?.id;
  const fields = resource?.fields || {};

  if (!workItemId) {
    logger.warn(t('webhook.log_invalid_payload'), { eventType });
    return res.status(400).json({ error: t('webhook.err_bad_request'), reason: t('webhook.err_workitemid_required') });
  }

  logger.info(t('webhook.log_received'), { workItemId, eventType });

  let workItemFields;
  try {
    workItemFields = await fetchWorkItem(workItemId);
  } catch (err) {
    logger.error(t('webhook.log_fetch_failed'), { workItemId, message: err.message });
    return res.status(500).json({ error: t('webhook.err_workitem_fetch') });
  }

  const { shouldTrigger, code, reason, repoName, repoConfig } = analyze(workItemFields);
  if (!shouldTrigger) {
    return res.status(200).json({ status: 'skipped', code, reason });
  }

  const lockAcquired = await acquireLock(workItemId);
  if (!lockAcquired) {
    logger.info(t('webhook.log_debounced'), { workItemId });
    return res.status(200).json({ status: 'debounced', workItemId });
  }

  try {
    const duplicate = await isDuplicate(eventType, workItemId, fields);
    if (duplicate) {
      return res.status(200).json({ status: 'duplicate', workItemId });
    }

    const cooldown = await getCooldown(workItemId);
    if (cooldown) {
      logger.info(t('webhook.log_cooldown_active'), { workItemId, runId: cooldown.id });
      return res.status(200).json({ status: 'cooldown', workItemId, pipelineRunId: cooldown.id });
    }

    const run = await trigger(workItemId, repoConfig);
    await setCooldown(workItemId, run);
    return res.status(200).json({ status: 'triggered', workItemId, repoName, runId: run.id });
  } catch (err) {
    logger.error(t('webhook.log_pipeline_failed'), { workItemId, message: err.message });
    return res.status(500).json({ error: t('webhook.err_pipeline_trigger') });
  } finally {
    await releaseLock(workItemId);
  }
});

module.exports = router;
