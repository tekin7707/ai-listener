const logger = require('../lib/logger');
const repos = require('../../config/repos.json');

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
  const tagsRaw = getFieldText(fields['System.Tags']);
  const tagList = tagsRaw.split(';').map(t => t.trim()).filter(Boolean);
  const aiTag = tagList.find(t => t.toLowerCase().startsWith('ai-agent:'));

  if (!aiTag) {
    const validRepos = Object.keys(repos).join(', ') || '(repos.json boş)';
    const reason = `"ai-agent:<repo>" formatında bir etiket bulunamadı. Mevcut etiketler: "${tagsRaw || '(boş)'}". Tanımlı repolar: ${validRepos}`;
    logger.info('Koşul sağlanmadı', { reason });
    return { shouldTrigger: false, code: 'TAG_MISSING', reason };
  }

  const repoName = aiTag.slice('ai-agent:'.length).trim().toLowerCase();

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
