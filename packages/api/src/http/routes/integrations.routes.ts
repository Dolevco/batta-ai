import express from 'express';
import type { AppContext } from '../../app/createContext';

export function createIntegrationsRouter(controllers: AppContext['controllers']): express.Router {
  const router = express.Router();
  const mcp = controllers.mcpIntegration;
  const builtIn = controllers.builtInIntegration;
  const custom = controllers.customIntegration;
  const integrations = controllers.integrations;
  const slackOAuth = controllers.slackOAuth;
  const githubOAuth = controllers.githubOAuth;
  const githubToken = controllers.githubToken;

  router.post('/integrations/mcp', mcp.createIntegration.bind(mcp));
  router.get('/integrations/mcp/:id', mcp.getIntegration.bind(mcp));
  router.get('/integrations/mcp/:id/details', mcp.getIntegrationDetails.bind(mcp));
  router.get('/integrations/mcp', mcp.getAllIntegrations.bind(mcp));
  router.put('/integrations/mcp/:id', mcp.updateIntegration.bind(mcp));
  router.delete('/integrations/mcp/:id', mcp.deleteIntegration.bind(mcp));

  router.get('/integrations/mcp/docker/servers', mcp.listDockerMCPServers.bind(mcp));
  router.post('/integrations/mcp/docker/add', mcp.addDockerMCPIntegration.bind(mcp));

  router.get('/integrations/built-in', builtIn.getBuiltInIntegrations.bind(builtIn));
  router.post('/integrations/built-in/validate', builtIn.validateIntegration.bind(builtIn));

  router.get('/integrations', integrations.getAllIntegrations.bind(integrations));

  router.post('/integrations/:type', custom.createIntegration.bind(custom));
  router.get('/integrations/:type/:id', custom.getIntegration.bind(custom));
  router.get('/integrations/:type', custom.getAllIntegrations.bind(custom));
  router.put('/integrations/:type/:id', custom.updateIntegration.bind(custom));
  router.delete('/integrations/:type/:id', custom.deleteIntegration.bind(custom));

  router.post('/oauth/slack/complete', slackOAuth.complete.bind(slackOAuth));
  router.post('/oauth/github/complete', githubOAuth.complete.bind(githubOAuth));

  router.post('/integrations/github/token', githubToken.configure.bind(githubToken));
  router.delete('/integrations/github/token', githubToken.revoke.bind(githubToken));

  return router;
}
