// Export GitHub integration
export { getInstallationToken, type InstallationAuthResult } from './githubAuth';
export { GitHubIntegration, type GitHubConfig } from './githubIntegration';

// Export Microsoft Defender integration
export { MicrosoftDefenderIntegration, type DefenderConfig, MsDefenderCategory } from './microsoftDefenderIntegration';

// Export Slack integration
export { SlackIntegration, type SlackConfig, SlackCategory } from './slackIntegration';