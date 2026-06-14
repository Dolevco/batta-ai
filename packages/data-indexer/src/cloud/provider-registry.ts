/**
 * Provider Registry
 *
 * Maps CloudProvider enum values to their CloudGraphProvider implementations.
 * Providers are registered at startup and resolved by the orchestrator.
 *
 * How to add a new provider (e.g. AWS):
 *  1. Create `cloud/providers/aws/aws-cloud-graph.provider.ts` implementing CloudGraphProvider.
 *  2. Import it here and register it with `registry.register(new AwsCloudGraphProvider(config))`.
 *  3. No other changes required.
 */

import { CloudProvider } from '@batta/shared';
import { CloudGraphProvider } from './cloud-graph-provider.interface';

export class ProviderRegistry {
  private providers = new Map<CloudProvider, CloudGraphProvider>();

  register(provider: CloudGraphProvider): this {
    this.providers.set(provider.cloudProvider, provider);
    return this;
  }

  /**
   * Retrieve a provider by cloud type.
   * Throws if no provider is registered for the given type.
   * (Fail-fast — calling code should not silently skip unknown providers.)
   */
  get(cloudProvider: CloudProvider): CloudGraphProvider {
    const provider = this.providers.get(cloudProvider);
    if (!provider) {
      throw new Error(
        `ProviderRegistry: no provider registered for cloudProvider="${cloudProvider}". ` +
        `Registered providers: [${Array.from(this.providers.keys()).join(', ')}]`,
      );
    }
    return provider;
  }

  has(cloudProvider: CloudProvider): boolean {
    return this.providers.has(cloudProvider);
  }

  registeredProviders(): CloudProvider[] {
    return Array.from(this.providers.keys());
  }
}
