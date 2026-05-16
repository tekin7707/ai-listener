const axios = require('axios');
const logger = require('../lib/logger');
const { t } = require('../lib/i18n');

const ORG = process.env.AZURE_DEVOPS_ORG;
const FALLBACK_PAT = process.env.AZURE_DEVOPS_PAT;

function resolveTriggerPat(repoConfig) {
  // Resolution order: per-repo override → project-inherited → env fallback.
  // repoConfig comes from REPO_INDEX (lib/repoIndex.js) which already inherits
  // the project's triggerPat into each repo entry.
  if (repoConfig.pat) return repoConfig.pat;
  if (repoConfig.triggerPat) return repoConfig.triggerPat;
  return FALLBACK_PAT;
}

async function trigger(workItemId, repoConfig) {
  const { project, pipelineId } = repoConfig;
  const pat = resolveTriggerPat(repoConfig);

  const url = `${ORG}/${project}/_apis/pipelines/${pipelineId}/runs?api-version=7.1`;
  const auth = Buffer.from(`:${pat}`).toString('base64');
  const body = { templateParameters: { workItemId: String(workItemId) } };

  logger.info(t('pipeline.log_triggering'), { workItemId, url });

  try {
    const response = await axios.post(url, body, {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    });

    logger.info(t('pipeline.log_triggered'), { workItemId, runId: response.data.id });
    return response.data;
  } catch (err) {
    const detail = err.response?.data;
    logger.error(t('pipeline.log_ado_error'), { workItemId, url, status: err.response?.status, detail });
    throw err;
  }
}

module.exports = { trigger };
