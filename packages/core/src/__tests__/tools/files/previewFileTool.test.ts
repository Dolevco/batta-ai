import * as os from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';
import { PreviewFileTool } from '../../../tools/files/fileTools';

async function makeTool(): Promise<{ tool: PreviewFileTool; workspacePath: string }> {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-test-'));
  const tool = new PreviewFileTool({ workspacePath });
  return { tool, workspacePath };
}

async function cleanup(workspacePath: string) {
  await fs.rm(workspacePath, { recursive: true, force: true });
}

describe('PreviewFileTool (integration)', () => {
  it('returns a valid FileSummary for a TypeScript file', async () => {
    const { tool, workspacePath } = await makeTool();
    try {
      const filePath = path.join(workspacePath, 'sample.ts');
      await fs.writeFile(filePath, [
        "import { foo } from 'bar';",
        '',
        'export class MyClass {',
        '  myMethod() {}',
        '}',
      ].join('\n'), 'utf-8');

      const result = await tool.execute({ path: 'sample.ts' });

      expect(result.success).toBe(true);
      expect(result.result).toMatchObject({
        file: 'sample.ts',
        type: 'typescript',
        total_lines: 5,
      });
      expect(typeof result.result.last_modified).toBe('string');
      expect(result.result.last_modified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Array.isArray(result.result.items)).toBe(true);
      expect(result.result.items.length).toBeGreaterThan(0);
    } finally {
      await cleanup(workspacePath);
    }
  });

  it('returns success with 0 items for a generic file', async () => {
    const { tool, workspacePath } = await makeTool();
    try {
      const filePath = path.join(workspacePath, 'data.bin');
      await fs.writeFile(filePath, 'binary-like content', 'utf-8');

      const result = await tool.execute({ path: 'data.bin' });
      expect(result.success).toBe(true);
      expect(result.result.items).toHaveLength(0);
      expect(result.result.type).toBe('generic');
    } finally {
      await cleanup(workspacePath);
    }
  });

  it('returns failure for a non-existent file', async () => {
    const { tool, workspacePath } = await makeTool();
    try {
      const result = await tool.execute({ path: 'does-not-exist.ts' });
      expect(result.success).toBe(false);
      expect(result.message).toBeTruthy();
      // Workspace path must not appear in the error message (sanitized)
      expect(result.message).not.toContain(workspacePath);
      if (result.error) {
        expect(result.error).not.toContain(workspacePath);
      }
    } finally {
      await cleanup(workspacePath);
    }
  });

  it('rejects path traversal attempts', async () => {
    const { tool, workspacePath } = await makeTool();
    try {
      const result = await tool.execute({ path: '../../etc/passwd' });
      expect(result.success).toBe(false);
    } finally {
      await cleanup(workspacePath);
    }
  });

  it('isConcurrencySafe is true', () => {
    const tool = new PreviewFileTool({ workspacePath: os.tmpdir() });
    expect(tool.isConcurrencySafe).toBe(true);
  });

  it('has the correct name', () => {
    const tool = new PreviewFileTool({ workspacePath: os.tmpdir() });
    expect(tool.name).toBe('preview_file');
  });
});
