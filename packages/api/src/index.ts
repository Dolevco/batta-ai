import { createApp } from './app/createApp';
import { createAppContext } from './app/createContext';
import { startServer } from './app/startServer';
import { loadEnv } from './config/env';
import { logStartupError } from './config/logger';

async function main(): Promise<void> {
  const env = loadEnv();
  const context = await createAppContext(env);
  const app = createApp(context);
  await startServer(app, env);
}

main().catch((error) => {
  try {
    logStartupError(error, loadEnv());
  } catch {
    console.error('Failed to start server:', error);
  }
  process.exit(1);
});
