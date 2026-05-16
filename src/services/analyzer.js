const logger = require('../lib/logger');
const { t } = require('../lib/i18n');
const { REPO_INDEX } = require('../lib/repoIndex');

const TRIGGER_STATE = process.env.WEBHOOK_TRIGGER_STATE || 'To Do';
const TAG_PREFIX = process.env.AI_AGENT_TAG_PREFIX || 'ai-agent';
const TRIGGER_TAG_PREFIX = `${TAG_PREFIX}:`;

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
    const reason = t('analyzer.state_not_allowed', { trigger: TRIGGER_STATE, state: state || '(empty)' });
    logger.info(t('analyzer.log_condition_failed'), { reason });
    return { shouldTrigger: false, code: 'STATE_NOT_ALLOWED', reason };
  }

  const tagsRaw = getFieldText(fields['System.Tags']);
  const tagList = tagsRaw.split(';').map(s => s.trim()).filter(Boolean);
  const aiTag = tagList.find(s => s.toLowerCase().startsWith(TRIGGER_TAG_PREFIX.toLowerCase()));
  const knownRepos = Object.keys(REPO_INDEX).join(', ') || '(projects.json empty)';

  if (!aiTag) {
    const reason = t('analyzer.tag_missing', { prefix: TAG_PREFIX, tags: tagsRaw || '(empty)', repos: knownRepos });
    logger.info(t('analyzer.log_condition_failed'), { reason });
    return { shouldTrigger: false, code: 'TAG_MISSING', reason };
  }

  const repoName = aiTag.slice(TRIGGER_TAG_PREFIX.length).split(':')[0].trim().toLowerCase();

  if (!repoName) {
    const reason = t('analyzer.repo_empty', { prefix: TAG_PREFIX, repos: knownRepos });
    logger.info(t('analyzer.log_condition_failed'), { reason });
    return { shouldTrigger: false, code: 'REPO_EMPTY', reason };
  }

  if (!REPO_INDEX[repoName]) {
    const reason = t('analyzer.repo_unknown', { repo: repoName, repos: knownRepos });
    logger.info(t('analyzer.log_condition_failed'), { reason });
    return { shouldTrigger: false, code: 'REPO_UNKNOWN', reason };
  }

  return { shouldTrigger: true, code: 'OK', repoName, repoConfig: REPO_INDEX[repoName], reason: t('analyzer.ok') };
}

module.exports = { analyze };
