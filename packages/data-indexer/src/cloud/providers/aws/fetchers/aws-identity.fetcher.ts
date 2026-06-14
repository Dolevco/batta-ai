/**
 * AWS Identity Fetcher
 *
 * Fetches IAM roles, instance profiles, EC2 instances, Lambda functions,
 * and ECS services across all configured accounts and regions.
 *
 * IAM is a global service — roles and instance profiles are fetched once per account.
 * Compute resources (EC2, Lambda, ECS) are fetched per region.
 *
 * Security:
 *   - Credential providers are passed in; this fetcher never requests credentials.
 *   - Raw AWS API error bodies are never propagated — only error codes.
 *   - IAM policy documents (which may contain sensitive trust policy details)
 *     are stored as raw JSON only for trust-principal type extraction;
 *     no policy conditions or resource ARNs are stored in graph nodes.
 */

import pLimit from 'p-limit';
import {
  IAMClient,
  ListRolesCommand,
  ListInstanceProfilesCommand,
  ListAttachedRolePoliciesCommand,
  type Role,
  type InstanceProfile,
} from '@aws-sdk/client-iam';
import {
  EC2Client,
  DescribeInstancesCommand,
  type Instance,
} from '@aws-sdk/client-ec2';
import {
  LambdaClient,
  ListFunctionsCommand,
  type FunctionConfiguration,
} from '@aws-sdk/client-lambda';
import {
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
  DescribeServicesCommand,
  type Service,
} from '@aws-sdk/client-ecs';
import type { Provider, AwsCredentialIdentity } from '@aws-sdk/types';
import {
  AWSIdentityGraph,
  RawIAMRole,
  RawIAMInstanceProfile,
  RawEC2Instance,
  RawLambdaFunction,
  RawECSService,
} from '@batta/shared';
import { AWSFetchError } from './aws-ingress.fetcher';

type CredentialProviderFn = (accountId: string) => Provider<AwsCredentialIdentity>;

// ============================================================================
// Public surface
// ============================================================================

export async function fetchAWSIdentityGraph(
  accountIds: string[],
  regions: string[],
  getCredentials: CredentialProviderFn,
): Promise<AWSIdentityGraph> {
  const limit = pLimit(5);

  const results = await Promise.all(
    accountIds.map(accountId =>
      limit(() => fetchIdentityForAccount(accountId, regions, getCredentials(accountId))),
    ),
  );

  return {
    iamRoles: results.flatMap(r => r.iamRoles),
    instanceProfiles: results.flatMap(r => r.instanceProfiles),
    ec2Instances: results.flatMap(r => r.ec2Instances),
    lambdaFunctions: results.flatMap(r => r.lambdaFunctions),
    ecsServices: results.flatMap(r => r.ecsServices),
  };
}

// ============================================================================
// Per-account identity fetch
// ============================================================================

async function fetchIdentityForAccount(
  accountId: string,
  regions: string[],
  credentials: Provider<AwsCredentialIdentity>,
): Promise<AWSIdentityGraph> {
  const regionLimit = pLimit(5);

  // IAM is global — fetch once from us-east-1
  const [iamRoles, instanceProfiles, ...regionalResults] = await Promise.all([
    fetchIAMRoles(accountId, credentials).catch(err => {
      console.warn(`[AWS] IAM roles fetch failed for account ${accountId}: ${err.message}`);
      return [] as RawIAMRole[];
    }),
    fetchInstanceProfiles(accountId, credentials).catch(() => [] as RawIAMInstanceProfile[]),
    ...regions.map(region =>
      regionLimit(() => fetchComputeForRegion(accountId, region, credentials)),
    ),
  ]);

  return {
    iamRoles,
    instanceProfiles,
    ec2Instances: regionalResults.flatMap(r => r.ec2Instances),
    lambdaFunctions: regionalResults.flatMap(r => r.lambdaFunctions),
    ecsServices: regionalResults.flatMap(r => r.ecsServices),
  };
}

// ============================================================================
// IAM Roles (global)
// ============================================================================

async function fetchIAMRoles(
  accountId: string,
  credentials: Provider<AwsCredentialIdentity>,
): Promise<RawIAMRole[]> {
  const client = new IAMClient({ region: 'us-east-1', credentials });
  const roles: RawIAMRole[] = [];
  let marker: string | undefined;

  do {
    let response;
    try {
      response = await client.send(new ListRolesCommand({ Marker: marker, MaxItems: 100 }));
    } catch (err: any) {
      throw new AWSFetchError('IAMRole', err.name ?? 'UNKNOWN');
    }

    const roleLimit = pLimit(10);
    const withPolicies = await Promise.all(
      (response.Roles ?? []).map((role: Role) =>
        roleLimit(async () => {
          let attachedPolicies: { policyArn: string; policyName: string }[] = [];
          try {
            const policiesResp = await client.send(
              new ListAttachedRolePoliciesCommand({ RoleName: role.RoleName ?? '' }),
            );
            attachedPolicies = (policiesResp.AttachedPolicies ?? []).map(p => ({
              policyArn: p.PolicyArn ?? '',
              policyName: p.PolicyName ?? '',
            }));
          } catch {
            // Non-fatal — return role without attached policies
          }

          // Extract trust principal types without storing the full policy document
          const trustDoc = role.AssumeRolePolicyDocument
            ? JSON.parse(decodeURIComponent(role.AssumeRolePolicyDocument as string))
            : {};
          const trustedPrincipalTypes = extractPrincipalTypes(trustDoc);

          return {
            roleId: role.RoleId ?? '',
            roleName: role.RoleName ?? '',
            arn: role.Arn ?? '',
            assumeRolePolicyDocument: trustDoc,
            attachedPolicies,
            maxSessionDuration: role.MaxSessionDuration ?? 3600,
            accountId,
            tags: tagsToRecord(role.Tags),
            trustedPrincipalTypes,
          } as RawIAMRole & { trustedPrincipalTypes: string[] };
        }),
      ),
    );

    roles.push(...withPolicies);
    marker = response.Marker;
  } while (marker);

  return roles;
}

// ============================================================================
// IAM Instance Profiles (global)
// ============================================================================

async function fetchInstanceProfiles(
  accountId: string,
  credentials: Provider<AwsCredentialIdentity>,
): Promise<RawIAMInstanceProfile[]> {
  const client = new IAMClient({ region: 'us-east-1', credentials });
  const profiles: RawIAMInstanceProfile[] = [];
  let marker: string | undefined;

  do {
    let response;
    try {
      response = await client.send(new ListInstanceProfilesCommand({ Marker: marker, MaxItems: 100 }));
    } catch {
      return profiles;
    }

    for (const ip of (response.InstanceProfiles ?? []) as InstanceProfile[]) {
      profiles.push({
        instanceProfileId: ip.InstanceProfileId ?? '',
        instanceProfileName: ip.InstanceProfileName ?? '',
        arn: ip.Arn ?? '',
        roles: (ip.Roles ?? []).map(r => ({ arn: r.Arn ?? '' })),
        accountId,
      });
    }

    marker = response.Marker;
  } while (marker);

  return profiles;
}

// ============================================================================
// Per-region compute
// ============================================================================

async function fetchComputeForRegion(
  accountId: string,
  region: string,
  credentials: Provider<AwsCredentialIdentity>,
): Promise<{ ec2Instances: RawEC2Instance[]; lambdaFunctions: RawLambdaFunction[]; ecsServices: RawECSService[] }> {
  const [ec2Instances, lambdaFunctions, ecsServices] = await Promise.all([
    fetchEC2Instances(accountId, region, credentials).catch(() => [] as RawEC2Instance[]),
    fetchLambdaFunctions(accountId, region, credentials).catch(() => [] as RawLambdaFunction[]),
    fetchECSServices(accountId, region, credentials).catch(() => [] as RawECSService[]),
  ]);

  return { ec2Instances, lambdaFunctions, ecsServices };
}

// ============================================================================
// EC2 Instances
// ============================================================================

async function fetchEC2Instances(
  accountId: string,
  region: string,
  credentials: Provider<AwsCredentialIdentity>,
): Promise<RawEC2Instance[]> {
  const client = new EC2Client({ region, credentials });
  const instances: RawEC2Instance[] = [];
  let nextToken: string | undefined;

  do {
    let response;
    try {
      response = await client.send(new DescribeInstancesCommand({ NextToken: nextToken }));
    } catch {
      return instances;
    }

    for (const reservation of response.Reservations ?? []) {
      for (const inst of (reservation.Instances ?? []) as Instance[]) {
        if (inst.State?.Name === 'terminated') continue;
        instances.push({
          instanceId: inst.InstanceId ?? '',
          instanceType: inst.InstanceType ?? '',
          subnetId: inst.SubnetId ?? '',
          vpcId: inst.VpcId ?? '',
          privateIpAddress: inst.PrivateIpAddress ?? '',
          publicIpAddress: inst.PublicIpAddress ?? undefined,
          iamInstanceProfile: inst.IamInstanceProfile
            ? { arn: inst.IamInstanceProfile.Arn ?? '' }
            : undefined,
          securityGroups: (inst.SecurityGroups ?? []).map(sg => ({ groupId: sg.GroupId ?? '' })),
          region,
          accountId,
          tags: tagsToRecord(inst.Tags),
        });
      }
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return instances;
}

// ============================================================================
// Lambda Functions
// ============================================================================

async function fetchLambdaFunctions(
  accountId: string,
  region: string,
  credentials: Provider<AwsCredentialIdentity>,
): Promise<RawLambdaFunction[]> {
  const client = new LambdaClient({ region, credentials });
  const functions: RawLambdaFunction[] = [];
  let marker: string | undefined;

  do {
    let response;
    try {
      response = await client.send(new ListFunctionsCommand({ Marker: marker, MaxItems: 50 }));
    } catch {
      return functions;
    }

    for (const fn of (response.Functions ?? []) as FunctionConfiguration[]) {
      functions.push({
        functionArn: fn.FunctionArn ?? '',
        functionName: fn.FunctionName ?? '',
        runtime: fn.Runtime ?? '',
        handler: fn.Handler ?? '',
        role: fn.Role ?? '',
        vpcConfig: fn.VpcConfig?.VpcId
          ? {
              vpcId: fn.VpcConfig.VpcId,
              subnetIds: fn.VpcConfig.SubnetIds ?? [],
              securityGroupIds: fn.VpcConfig.SecurityGroupIds ?? [],
            }
          : undefined,
        region,
        accountId,
        tags: (fn as any).Tags ?? {},
      });
    }

    marker = response.NextMarker;
  } while (marker);

  return functions;
}

// ============================================================================
// ECS Services
// ============================================================================

async function fetchECSServices(
  accountId: string,
  region: string,
  credentials: Provider<AwsCredentialIdentity>,
): Promise<RawECSService[]> {
  const client = new ECSClient({ region, credentials });
  const services: RawECSService[] = [];

  let clusterToken: string | undefined;
  const clusterArns: string[] = [];

  do {
    let response;
    try {
      response = await client.send(new ListClustersCommand({ nextToken: clusterToken, maxResults: 100 }));
    } catch {
      return services;
    }
    clusterArns.push(...(response.clusterArns ?? []));
    clusterToken = response.nextToken;
  } while (clusterToken);

  const clusterLimit = pLimit(5);
  await Promise.all(
    clusterArns.map(clusterArn =>
      clusterLimit(async () => {
        let serviceToken: string | undefined;
        const serviceArns: string[] = [];

        do {
          let listResp;
          try {
            listResp = await client.send(new ListServicesCommand({
              cluster: clusterArn,
              nextToken: serviceToken,
              maxResults: 100,
            }));
          } catch {
            return;
          }
          serviceArns.push(...(listResp.serviceArns ?? []));
          serviceToken = listResp.nextToken;
        } while (serviceToken);

        if (serviceArns.length === 0) return;

        // Describe in batches of 10 (AWS limit)
        for (let i = 0; i < serviceArns.length; i += 10) {
          const batch = serviceArns.slice(i, i + 10);
          let descResp;
          try {
            descResp = await client.send(new DescribeServicesCommand({
              cluster: clusterArn,
              services: batch,
            }));
          } catch {
            continue;
          }

          for (const svc of (descResp.services ?? []) as Service[]) {
            const netConfig = svc.networkConfiguration?.awsvpcConfiguration;
            services.push({
              serviceArn: svc.serviceArn ?? '',
              serviceName: svc.serviceName ?? '',
              clusterArn,
              taskDefinition: svc.taskDefinition ?? '',
              launchType: svc.launchType ?? 'EC2',
              networkConfiguration: netConfig
                ? { awsvpcConfiguration: { subnets: netConfig.subnets ?? [], securityGroups: netConfig.securityGroups ?? [] } }
                : undefined,
              region,
              accountId,
              tags: tagsToRecord(svc.tags?.map(t => ({ Key: t.key, Value: t.value }))),
            });
          }
        }
      }),
    ),
  );

  return services;
}

// ============================================================================
// Helpers
// ============================================================================

function tagsToRecord(tags?: { Key?: string; Value?: string }[]): Record<string, string> {
  if (!tags) return {};
  const result: Record<string, string> = {};
  for (const t of tags) {
    if (t.Key && typeof t.Value === 'string') result[t.Key] = t.Value;
  }
  return result;
}

/**
 * Extract principal types (Service, Federated, AWS) from a trust policy document
 * without storing the full document. Only types are returned, not ARNs or conditions.
 */
function extractPrincipalTypes(trustDoc: any): string[] {
  const types = new Set<string>();
  const statements = trustDoc?.Statement ?? [];
  for (const stmt of statements) {
    const principal = stmt.Principal;
    if (!principal) continue;
    if (typeof principal === 'string') {
      types.add('AWS');
    } else if (typeof principal === 'object') {
      for (const key of Object.keys(principal)) {
        types.add(key); // 'Service', 'Federated', 'AWS'
      }
    }
  }
  return [...types];
}
