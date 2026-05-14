const axios = require('axios');
const logger = require('../lib/logger');

const ORG = process.env.AZURE_DEVOPS_ORG;

async function trigger(workItemId, repoConfig) {
  const { project, pat, pipelineId } = repoConfig;

  const url = `${ORG}/${project}/_apis/pipelines/${pipelineId}/runs?api-version=7.1`;
  const auth = Buffer.from(`:${pat}`).toString('base64');
  const body = { templateParameters: { workItemId: String(workItemId) } };

  logger.info('Pipeline tetikleniyor', { workItemId, url });

  try {
    const response = await axios.post(url, body, {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    });

    logger.info('Pipeline tetiklendi', { workItemId, runId: response.data.id });
    return response.data;
  } catch (err) {
    const detail = err.response?.data;
    logger.error('Azure DevOps API hatası', { workItemId, url, status: err.response?.status, detail });
    throw err;
  }
}

module.exports = { trigger };
