const fs = require('fs');
const path = require('path');

/**
 * Reads config/projects.json (nested by project) and builds two views:
 *   PROJECTS — the raw project map
 *   REPO_INDEX — a flat lookup keyed by lowercase repo name; each entry
 *                inherits triggerPat from its parent project. Per-repo `pat`
 *                inside the project entry still wins over the inherited one.
 *
 * Schema of config/projects.json:
 *   {
 *     "<ProjectName>": {
 *       "triggerPat": "<azure-devops-pat>",
 *       "repos": [
 *         { "repo": "<name>", "pipelineId": "<id>", "pat": "<optional override>" }
 *       ]
 *     }
 *   }
 */
const projectsPath = path.join(__dirname, '..', '..', 'config', 'projects.json');

let PROJECTS = {};
try {
  PROJECTS = JSON.parse(fs.readFileSync(projectsPath, 'utf8'));
} catch (err) {
  if (err.code !== 'ENOENT') {
    throw new Error(`config/projects.json could not be parsed: ${err.message}`);
  }
}

const REPO_INDEX = {};
for (const [project, cfg] of Object.entries(PROJECTS)) {
  const triggerPat = cfg.triggerPat;
  for (const r of (cfg.repos || [])) {
    if (!r.repo) continue;
    REPO_INDEX[r.repo.toLowerCase()] = {
      project,
      pipelineId: r.pipelineId,
      triggerPat,
      pat: r.pat,  // optional per-repo override; undefined if not set
    };
  }
}

module.exports = { PROJECTS, REPO_INDEX };
