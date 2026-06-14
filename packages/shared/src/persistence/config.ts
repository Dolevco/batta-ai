export interface DatabaseConfig {
  connectionString: string;
}

export function getDatabaseConfig(): DatabaseConfig {
  return {
    connectionString: process.env.DATABASE_URL || 'postgresql://app:changeme@localhost:5432/app',
  };
}
