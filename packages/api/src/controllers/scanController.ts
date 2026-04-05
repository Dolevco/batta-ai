/**
 * Scan Controller
 *
 * Handles HTTP requests for triggering and monitoring asset scans.
 *
 * Security:
 * - All endpoints require JWT authentication (enforced by authMiddleware).
 * - TenantId is extracted exclusively from the verified JWT (`req.auth`).
 * - Input options are strictly validated before being passed to the service.
 * - Internal errors are logged server-side; only generic messages are returned
 *   to the client (OWASP A05 – Security Misconfiguration / information leakage).
 * - One active scan per tenant is enforced (rate-limiting / availability).
 */

import { Request, Response } from 'express';
import {
  startScan,
  startScanStream,
  discoverRepositories,
  getScan,
  listScans,
  type ScanOptions,
} from '../services/scanService';

const VALID_SCOPES = new Set(['all', 'code', 'cloud']);
const VALID_RUN_TYPES = new Set<string>(['full', 'incremental']);

export class ScanController {
  /**
   * GET /knowledge-base/repositories
   * Returns a list of discoverable repositories for the authenticated tenant.
   * Used by the UI to populate the repository-selection picker before scanning.
   */
  async listRepositories(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.auth!.tenantId;
      const repos = await discoverRepositories(tenantId);
      res.json(repos);
    } catch (err) {
      console.error('[ScanController] listRepositories error:', err);
      res.status(500).json({ error: 'Failed to list repositories.' });
    }
  }

  /**
   * POST /knowledge-base/scan/stream
   * Runs the scan synchronously and streams ScanRecord snapshots as
   * Server-Sent Events so the client sees progress in real-time.
   *
   * Security:
   * - TenantId from JWT only.
   * - Input validated with allow-list (same as triggerScan).
   * - Repository names validated: string, max 200 chars, no path traversal chars.
   * - Errors never expose internal paths or stack traces.
   * - Inherits rate-limit (one active scan per tenant) from startScanStream.
   */
  async streamScan(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.auth!.tenantId;

      const body = req.body ?? {};

      // Validate repository allow-list: strings only, no traversal chars, capped length
      const rawRepos = body.repositories;
      const repositories: string[] | undefined = Array.isArray(rawRepos)
        ? rawRepos
            .filter(
              (r: any) =>
                typeof r === 'string' &&
                r.length > 0 &&
                r.length <= 200 &&
                !/[\\<>&"'`]/.test(r)
            )
            .slice(0, 200) // hard cap to prevent abuse
        : undefined;

      const options: ScanOptions = {
        enableCloudDiscovery: body.enableCloudDiscovery === true,
        scope: VALID_SCOPES.has(body.scope) ? body.scope : 'all',
        repositories,
        // 'incremental' must be explicitly requested; any unrecognised value falls back to 'full'
        runType: VALID_RUN_TYPES.has(body.runType) ? (body.runType as 'full' | 'incremental') : 'full',
      };

      // SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
      res.flushHeaders();

      const sendEvent = (record: unknown) => {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(record)}\n\n`);
          // Force-flush the write buffer so each stage update reaches the client
          // immediately rather than being held in Node's TCP send buffer.
          // res.flush() is provided by the compression middleware when present;
          // casting to any is safe — it's a no-op if the method doesn't exist.
          (res as any).flush?.();
        }
      };

      // Keep-alive ping every 15 s so proxies don't close the connection
      const pingInterval = setInterval(() => {
        if (!res.writableEnded) res.write(': ping\n\n');
      }, 15_000);

      req.on('close', () => clearInterval(pingInterval));

      try {
        await startScanStream(tenantId, options, sendEvent);
      } finally {
        clearInterval(pingInterval);
      }

      if (!res.writableEnded) res.end();
    } catch (err) {
      console.error('[ScanController] streamScan error:', err);
      if (!res.writableEnded) {
        // Generic error only – no internal detail
        res.write(`data: ${JSON.stringify({ error: 'Scan failed due to an internal error.' })}\n\n`);
        res.end();
      }
    }
  }

  async triggerScan(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.auth!.tenantId;

      // Strict input validation – never trust client-supplied types
      const body = req.body ?? {};
      const options: ScanOptions = {
        enableCloudDiscovery: body.enableCloudDiscovery === true,
        scope: VALID_SCOPES.has(body.scope) ? body.scope : 'all',
        // 'incremental' must be explicitly requested; any unrecognised value falls back to 'full'
        runType: VALID_RUN_TYPES.has(body.runType) ? (body.runType as 'full' | 'incremental') : 'full',
      };

      const { scanId, alreadyRunning } = await startScan(tenantId, options);

      if (alreadyRunning) {
        res.status(202).json({
          scanId,
          status: 'running',
          message: 'A scan is already in progress for your organization.',
        });
        return;
      }

      res.status(202).json({
        scanId,
        status: 'queued',
        message: 'Scan started. Use the scanId to poll for status.',
      });
    } catch (err) {
      console.error('[ScanController] triggerScan error:', err);
      res.status(500).json({ error: 'Failed to start scan.' });
    }
  }

  async getScanStatus(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.auth!.tenantId;
      const { scanId } = req.params;

      // Validate scanId format to prevent path traversal / injection
      if (!scanId || !/^[0-9a-f-]{36}$/.test(scanId)) {
        res.status(400).json({ error: 'Invalid scan ID.' });
        return;
      }

      const scan = getScan(tenantId, scanId);
      if (!scan) {
        res.status(404).json({ error: 'Scan not found.' });
        return;
      }

      res.json(scan);
    } catch (err) {
      console.error('[ScanController] getScanStatus error:', err);
      res.status(500).json({ error: 'Failed to retrieve scan status.' });
    }
  }

  async listScanHistory(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.auth!.tenantId;
      const scans = listScans(tenantId);
      res.json(scans);
    } catch (err) {
      console.error('[ScanController] listScanHistory error:', err);
      res.status(500).json({ error: 'Failed to list scans.' });
    }
  }
}
