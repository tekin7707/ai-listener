const axios = require('axios');
const logger = require('../lib/logger');

const ORG = process.env.AZURE_DEVOPS_ORG;
const PAT = process.env.AZURE_DEVOPS_PAT;

async function fetchWorkItem(workItemId) {
  const url = `${ORG}/_apis/wit/workitems/${workItemId}?api-version=7.1`;
  const auth = Buffer.from(`:${PAT}`).toString('base64');

  logger.info('Work item çekiliyor', {
    workItemId,
    curl: `curl -u ":${PAT}" "${url}"`
  });

  const response = await axios.get(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json'
    }
  });

  return response.data.fields;
}

module.exports = { fetchWorkItem };
