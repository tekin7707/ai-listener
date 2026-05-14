const logger = require('../lib/logger');
const repos = require('../../config/repos.json');

const AGENT_USERNAME = process.env.AGENT_USERNAME || 'copilot';

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
  const assignedTo = getFieldText(fields['System.AssignedTo']);

  if (!assignedTo.toLowerCase().includes(AGENT_USERNAME.toLowerCase())) {
    const reason = `assignedTo izin verilen kullanıcıyı içermiyor (assignedTo: "${assignedTo}")`;
    logger.info('Koşul sağlanmadı', { reason });
    return { shouldTrigger: false, reason };
  }

  const tagsRaw = getFieldText(fields['System.Tags']);
  const aiTag = tagsRaw.split(';').map(t => t.trim().toLowerCase()).find(t => t.startsWith('ai-agent:'));

  if (!aiTag) {
    const reason = `"ai-agent:<repo>" tag bulunamadı (tags: "${tagsRaw}")`;
    logger.info('Koşul sağlanmadı', { reason });
    return { shouldTrigger: false, reason };
  }

  const repoName = aiTag.split(':')[1];
  if (!repoName || !repos[repoName]) {
    const reason = `Bilinmeyen repo: "${repoName}"`;
    logger.info('Koşul sağlanmadı', { reason });
    return { shouldTrigger: false, reason };
  }

  return { shouldTrigger: true, repoName, repoConfig: repos[repoName], reason: 'Tüm koşullar sağlandı' };
}

module.exports = { analyze };
