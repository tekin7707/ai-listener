const logger = require('../lib/logger');
const repos = require('../../config/repos.json');

const TRIGGER_STATE = process.env.WEBHOOK_TRIGGER_STATE || 'To Do';

function getFieldText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    for (const key of ['displayName', 'uniqueName', 'name', 'id']) {
      if (value[key]) return String(value[key]);
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function analyze(fields) {
  const state = getFieldText(fields['System.State']);
  if (state.toLowerCase() !== TRIGGER_STATE.toLowerCase()) {
    const reason = `Work item "${TRIGGER_STATE}" state'inde olmalı, mevcut state: "${state || '(boş)'}". Önce work item'ı "${TRIGGER_STATE}" durumuna alıp tekrar deneyin.`;
    logger.info('Koşul sağlanmadı', { reason });
    return { shouldTrigger: false, code: 'STATE_NOT_ALLOWED', reason };
  }

  const tagsRaw = getFieldText(fields['System.Tags']);
  const tagList = tagsRaw.split(';').map(t => t.trim()).filter(Boolean);
  const aiTag = tagList.find(t => t.toLowerCase().startsWith('ai-agent:'));

  if (!aiTag) {
    const validRepos = Object.keys(repos).join(', ') || '(repos.json boş)';
    const reason = `"ai-agent:<repo>" formatında bir etiket bulunamadı. Mevcut etiketler: "${tagsRaw || '(boş)'}". Tanımlı repolar: ${validRepos}`;
    logger.info('Koşul sağlanmadı', { reason });
    return { shouldTrigger: false, code: 'TAG_MISSING', reason };
  }

  // Format: "ai-agent:<repo>" veya "ai-agent:<repo>:<model>" — sadece repo'yu al
  const repoName = aiTag.slice('ai-agent:'.length).split(':')[0].trim().toLowerCase();

  if (!repoName) {
    const validRepos = Object.keys(repos).join(', ') || '(repos.json boş)';
    const reason = `"ai-agent:" etiketinde repo adı belirtilmemiş. Doğru kullanım: "ai-agent:<repo>". Tanımlı repolar: ${validRepos}`;
    logger.info('Koşul sağlanmadı', { reason });
    return { shouldTrigger: false, code: 'REPO_EMPTY', reason };
  }

  if (!repos[repoName]) {
    const validRepos = Object.keys(repos).join(', ') || '(repos.json boş)';
    const reason = `"${repoName}" repo'su tanımlı değil. Tanımlı repolar: ${validRepos}`;
    logger.info('Koşul sağlanmadı', { reason });
    return { shouldTrigger: false, code: 'REPO_UNKNOWN', reason };
  }

  return { shouldTrigger: true, code: 'OK', repoName, repoConfig: repos[repoName], reason: 'Tüm koşullar sağlandı' };
}

module.exports = { analyze };
