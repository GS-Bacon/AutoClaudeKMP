/**
 * 実験サンドボックス
 *
 * 実験用の隔離実行環境を管理
 */

import { getLogger } from '@auto-claude/core';
import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn, ChildProcess } from 'child_process';

const logger = getLogger('ExperimentSandbox');

const SANDBOX_BASE_PATH = '/home/bacon/AutoClaudeKMP/sandbox/experiments';

export interface SandboxConfig {
  experimentId: string;
  workDir: string;
  allowNetwork: boolean;
  allowFileSystem: boolean;
  resourceLimits: {
    memoryMB: number;
    cpuPercent: number;
    diskMB: number;
  };
}

export interface SandboxEnvironment {
  id: string;
  experimentId: string;
  path: string;
  status: 'creating' | 'ready' | 'running' | 'stopped' | 'error';
  createdAt: Date;
  config: SandboxConfig;
  processes: Map<string, ChildProcess>;
}

export interface SandboxFile {
  name: string;
  path: string;
  size: number;
  modifiedAt: Date;
}

const DEFAULT_RESOURCE_LIMITS = {
  memoryMB: 512,
  cpuPercent: 10,
  diskMB: 100,
};

export class ExperimentSandbox {
  private readonly sandboxes: Map<string, SandboxEnvironment> = new Map();

  constructor() {
    this.ensureBaseDirectory();
  }

  /**
   * サンドボックス環境を作成
   */
  async createSandbox(
    experimentId: string,
    config?: Partial<SandboxConfig>
  ): Promise<SandboxEnvironment> {
    const sandboxId = `sandbox-${experimentId}-${Date.now()}`;
    const sandboxPath = path.join(SANDBOX_BASE_PATH, sandboxId);

    const sandboxConfig: SandboxConfig = {
      experimentId,
      workDir: sandboxPath,
      allowNetwork: config?.allowNetwork ?? false,
      allowFileSystem: config?.allowFileSystem ?? true,
      resourceLimits: {
        ...DEFAULT_RESOURCE_LIMITS,
        ...config?.resourceLimits,
      },
    };

    logger.info('Creating sandbox', { sandboxId, experimentId });

    try {
      // ディレクトリ構造を作成
      await fs.promises.mkdir(sandboxPath, { recursive: true });
      await fs.promises.mkdir(path.join(sandboxPath, 'src'), { recursive: true });
      await fs.promises.mkdir(path.join(sandboxPath, 'data'), { recursive: true });
      await fs.promises.mkdir(path.join(sandboxPath, 'output'), { recursive: true });
      await fs.promises.mkdir(path.join(sandboxPath, 'logs'), { recursive: true });

      // 基本的な設定ファイルを作成
      await this.createConfigFiles(sandboxPath, sandboxConfig);

      const sandbox: SandboxEnvironment = {
        id: sandboxId,
        experimentId,
        path: sandboxPath,
        status: 'ready',
        createdAt: new Date(),
        config: sandboxConfig,
        processes: new Map(),
      };

      this.sandboxes.set(sandboxId, sandbox);

      logger.info('Sandbox created', { sandboxId, path: sandboxPath });

      return sandbox;
    } catch (error) {
      logger.error('Failed to create sandbox', { sandboxId, error });
      throw error;
    }
  }

  /**
   * サンドボックス内でコマンドを実行
   */
  async executeCommand(
    sandboxId: string,
    command: string,
    options: {
      timeout?: number;
      cwd?: string;
    } = {}
  ): Promise<{
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number | null;
  }> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    if (sandbox.status !== 'ready' && sandbox.status !== 'running') {
      throw new Error(`Sandbox is not ready: ${sandbox.status}`);
    }

    const workDir = options.cwd
      ? path.join(sandbox.path, options.cwd)
      : sandbox.path;

    logger.debug('Executing command in sandbox', {
      sandboxId,
      command,
      workDir,
    });

    sandbox.status = 'running';

    try {
      const result = execSync(command, {
        cwd: workDir,
        timeout: options.timeout ?? 60000,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        env: this.getSandboxEnv(sandbox),
      });

      sandbox.status = 'ready';

      return {
        success: true,
        stdout: result,
        stderr: '',
        exitCode: 0,
      };
    } catch (error) {
      sandbox.status = 'ready';

      const execError = error as {
        stdout?: string;
        stderr?: string;
        status?: number;
      };

      return {
        success: false,
        stdout: execError.stdout ?? '',
        stderr: execError.stderr ?? String(error),
        exitCode: execError.status ?? 1,
      };
    }
  }

  /**
   * サンドボックス内で長時間実行プロセスを開始
   */
  async startProcess(
    sandboxId: string,
    command: string,
    args: string[] = []
  ): Promise<string> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    const processId = `proc-${Date.now()}`;

    const process = spawn(command, args, {
      cwd: sandbox.path,
      env: this.getSandboxEnv(sandbox),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    sandbox.processes.set(processId, process);
    sandbox.status = 'running';

    // ログをファイルに書き込み
    const logStream = fs.createWriteStream(
      path.join(sandbox.path, 'logs', `${processId}.log`)
    );

    process.stdout?.pipe(logStream);
    process.stderr?.pipe(logStream);

    process.on('exit', (code) => {
      logger.info('Sandbox process exited', { sandboxId, processId, code });
      sandbox.processes.delete(processId);

      if (sandbox.processes.size === 0) {
        sandbox.status = 'ready';
      }
    });

    logger.info('Process started in sandbox', { sandboxId, processId, command });

    return processId;
  }

  /**
   * プロセスを停止
   */
  stopProcess(sandboxId: string, processId: string): void {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    const process = sandbox.processes.get(processId);
    if (process) {
      process.kill('SIGTERM');
      sandbox.processes.delete(processId);
      logger.info('Process stopped', { sandboxId, processId });
    }
  }

  /**
   * サンドボックスにファイルを追加
   */
  async addFile(
    sandboxId: string,
    relativePath: string,
    content: string
  ): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    const filePath = path.join(sandbox.path, relativePath);
    const dir = path.dirname(filePath);

    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(filePath, content);

    logger.debug('File added to sandbox', { sandboxId, relativePath });
  }

  /**
   * サンドボックスからファイルを読み取り
   */
  async readFile(sandboxId: string, relativePath: string): Promise<string> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    const filePath = path.join(sandbox.path, relativePath);
    return fs.promises.readFile(filePath, 'utf-8');
  }

  /**
   * サンドボックスのファイル一覧を取得
   */
  async listFiles(sandboxId: string, subDir?: string): Promise<SandboxFile[]> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    const targetDir = subDir
      ? path.join(sandbox.path, subDir)
      : sandbox.path;

    const files: SandboxFile[] = [];

    try {
      const entries = await fs.promises.readdir(targetDir, {
        withFileTypes: true,
      });

      for (const entry of entries) {
        if (entry.isFile()) {
          const filePath = path.join(targetDir, entry.name);
          const stat = await fs.promises.stat(filePath);
          files.push({
            name: entry.name,
            path: path.relative(sandbox.path, filePath),
            size: stat.size,
            modifiedAt: stat.mtime,
          });
        }
      }
    } catch {
      // ディレクトリがない場合は空を返す
    }

    return files;
  }

  /**
   * サンドボックスの出力を取得
   */
  async getOutput(sandboxId: string): Promise<SandboxFile[]> {
    return this.listFiles(sandboxId, 'output');
  }

  /**
   * サンドボックスを削除
   */
  async deleteSandbox(sandboxId: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      return;
    }

    // 全プロセスを停止
    for (const [processId, process] of sandbox.processes) {
      process.kill('SIGTERM');
      sandbox.processes.delete(processId);
    }

    // ファイルを削除
    try {
      await fs.promises.rm(sandbox.path, { recursive: true, force: true });
    } catch (error) {
      logger.warn('Failed to delete sandbox directory', { sandboxId, error });
    }

    this.sandboxes.delete(sandboxId);
    logger.info('Sandbox deleted', { sandboxId });
  }

  /**
   * サンドボックスの状態を取得
   */
  getSandbox(sandboxId: string): SandboxEnvironment | undefined {
    return this.sandboxes.get(sandboxId);
  }

  /**
   * 実験IDからサンドボックスを検索
   */
  getSandboxByExperiment(experimentId: string): SandboxEnvironment | undefined {
    for (const sandbox of this.sandboxes.values()) {
      if (sandbox.experimentId === experimentId) {
        return sandbox;
      }
    }
    return undefined;
  }

  /**
   * アクティブなサンドボックス一覧
   */
  getActiveSandboxes(): SandboxEnvironment[] {
    return Array.from(this.sandboxes.values()).filter(
      s => s.status === 'ready' || s.status === 'running'
    );
  }

  /**
   * サンドボックスのディスク使用量を取得
   */
  async getDiskUsage(sandboxId: string): Promise<number> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      return 0;
    }

    try {
      const result = execSync(`du -sb ${sandbox.path}`, { encoding: 'utf-8' });
      const [sizeStr] = result.split('\t');
      return parseInt(sizeStr, 10) / 1024 / 1024; // MB
    } catch {
      return 0;
    }
  }

  /**
   * サンドボックス出力を本番にマージ
   */
  async mergeToProduction(
    sandboxId: string,
    targetPath: string,
    options: {
      dryRun?: boolean;
      excludePatterns?: string[];
    } = {}
  ): Promise<{ merged: string[]; skipped: string[] }> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    const merged: string[] = [];
    const skipped: string[] = [];
    const outputDir = path.join(sandbox.path, 'output');

    const files = await this.listFiles(sandboxId, 'output');

    for (const file of files) {
      const shouldExclude = options.excludePatterns?.some(
        pattern => file.name.includes(pattern)
      );

      if (shouldExclude) {
        skipped.push(file.path);
        continue;
      }

      const sourcePath = path.join(outputDir, file.name);
      const destPath = path.join(targetPath, file.name);

      if (!options.dryRun) {
        await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
        await fs.promises.copyFile(sourcePath, destPath);
      }

      merged.push(file.path);
    }

    logger.info('Sandbox output merged', {
      sandboxId,
      targetPath,
      mergedCount: merged.length,
      skippedCount: skipped.length,
      dryRun: options.dryRun ?? false,
    });

    return { merged, skipped };
  }

  // Private methods

  private ensureBaseDirectory(): void {
    try {
      fs.mkdirSync(SANDBOX_BASE_PATH, { recursive: true });
    } catch {
      // 既存の場合は無視
    }
  }

  private async createConfigFiles(
    sandboxPath: string,
    config: SandboxConfig
  ): Promise<void> {
    // sandbox.jsonを作成
    await fs.promises.writeFile(
      path.join(sandboxPath, 'sandbox.json'),
      JSON.stringify(config, null, 2)
    );

    // READMEを作成
    const readme = `# Sandbox: ${config.experimentId}

Created: ${new Date().toISOString()}

## Structure

- src/     - ソースコード
- data/    - 入力データ
- output/  - 出力結果
- logs/    - ログファイル

## Configuration

- Network: ${config.allowNetwork ? 'Allowed' : 'Blocked'}
- FileSystem: ${config.allowFileSystem ? 'Allowed' : 'Restricted'}
- Memory Limit: ${config.resourceLimits.memoryMB} MB
- CPU Limit: ${config.resourceLimits.cpuPercent}%
`;

    await fs.promises.writeFile(path.join(sandboxPath, 'README.md'), readme);
  }

  private getSandboxEnv(sandbox: SandboxEnvironment): NodeJS.ProcessEnv {
    return {
      ...process.env,
      SANDBOX_ID: sandbox.id,
      SANDBOX_PATH: sandbox.path,
      SANDBOX_EXPERIMENT: sandbox.experimentId,
      // ネットワーク制限（シンボリックなもの - 実際の制限は別途必要）
      SANDBOX_NETWORK: sandbox.config.allowNetwork ? '1' : '0',
    };
  }
}

// シングルトンインスタンス
let sandboxInstance: ExperimentSandbox | null = null;

export function getExperimentSandbox(): ExperimentSandbox {
  if (!sandboxInstance) {
    sandboxInstance = new ExperimentSandbox();
  }
  return sandboxInstance;
}
