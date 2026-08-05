import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const VAULT_PATH = process.env.VAULT_PATH || './demo-vault';
const BANK_PATH = path.join(VAULT_PATH, '题库');
const VERSION_FILE_PATH = path.join(VAULT_PATH, '.math-atlas-version');

const CACHE_DEBUG = process.env.NODE_ENV === 'development';

function logCache(message: string, details?: unknown): void {
  if (!CACHE_DEBUG) return;

  if (details === undefined) {
    console.log(`[题库缓存] ${message}`);
    return;
  }

  console.log(`[题库缓存] ${message}`, details);
}

// 轻量元数据（不含正文，用于首页表格）
export interface QuestionMetaLight {
  qid: number;
  grade: string;
  source: string;
  number: string;
  type: string;
  exam_type: string;
  filePath: string;
  difficulty: number;
  knowledge: string[];
  tags: string[];
}

// 完整题目（含正文，用于展开详情和讲义）
export interface QuestionMeta extends QuestionMetaLight {
  content: string;
}

/** 创建轻量题目元数据的深复制，避免调用方污染缓存对象。 */
function cloneQuestionMetaLight(
  question: QuestionMetaLight
): QuestionMetaLight {
  return {
    ...question,
    knowledge: [...question.knowledge],
    tags: [...question.tags],
  };
}

/** 创建轻量题目元数据列表的深复制。 */
function cloneQuestionMetaList(
  questions: QuestionMetaLight[]
): QuestionMetaLight[] {
  return questions.map(cloneQuestionMetaLight);
}

/** 解析题目的 Markdown 正文为各个 section（题目、答案、解析等） */
export function parseSections(raw: string): Record<string, string> {
  const normalized = raw.replace(/\r\n/g, '\n');
  const result: Record<string, string> = {};
  const parts = normalized.split(/\n(?=## )/);

  for (const block of parts) {
    const match = block.match(/^## (.+?)\n([\s\S]*)$/);
    if (!match) continue;

    const title = match[1].trim();
    const body = match[2].trim();

    if (title === '备注') {
      const subSections = body.split(/\n(?=### )/);
      let noteBody = '';

      for (const subSection of subSections) {
        const subMatch = subSection.match(/^### (.+?)\n([\s\S]*)$/);

        if (subMatch) {
          result[subMatch[1].trim()] = subMatch[2].trim();
        } else {
          noteBody += subSection;
        }
      }

      if (noteBody.trim()) {
        result['备注'] = noteBody.trim();
      }
    } else {
      result[title] = body;
    }
  }

  return result;
}

/*
 * 进程内缓存。
 *
 * Next.js 开发环境可能为首页、添加 API、删除 API 创建不同模块实例，
 * 因此单独把 metaCache 设置为 null 不能通知其他模块实例。
 * cachedBankVersion 用于和磁盘版本文件比较，实现跨模块自动失效。
 */
let metaCache: QuestionMetaLight[] | null = null;
let cachedBankVersion: string | null = null;

/** 获取磁盘上的题库版本。 */
export function getQuestionBankVersion(): string {
  try {
    if (!fs.existsSync(VERSION_FILE_PATH)) {
      return '0';
    }

    return fs.readFileSync(VERSION_FILE_PATH, 'utf-8').trim() || '0';
  } catch (error) {
    console.warn('读取题库版本文件失败：', error);
    return '0';
  }
}

/**
 * 更新磁盘题库版本。
 *
 * 新增、覆盖、删除或恢复题目后调用。
 * 版本文件位于题库扫描目录之外，不会被当成题目读取。
 */
/**
 * 原子更新磁盘题库版本。
 *
 * 流程：
 * 1. 在版本文件所在目录创建唯一临时文件；
 * 2. 将完整版本号写入临时文件；
 * 3. 使用 fsync 确保内容已经提交；
 * 4. 通过 rename 原子替换正式版本文件。
 *
 * 读取方只会看到旧版本或新版本，
 * 不会看到正在写入中的空文件或半截内容。
 */
export function touchQuestionBankVersion(): string {
  const version = [
    Date.now(),
    process.pid,
    Math.random()
      .toString(36)
      .slice(2),
  ].join('-');

  if (!fs.existsSync(VAULT_PATH)) {
    fs.mkdirSync(VAULT_PATH, {
      recursive: true,
    });
  }

  /*
   * 临时文件和正式文件必须位于同一个目录，
   * 这样 rename 才能作为原子替换操作。
   */
  const temporaryFilePath = path.join(
    VAULT_PATH,
    `.math-atlas-version.${process.pid}.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2)}.tmp`
  );

  let fileDescriptor: number | null = null;

  try {
    /*
     * wx 表示仅在文件不存在时创建，
     * 避免并发请求使用同一个临时文件。
     */
    fileDescriptor = fs.openSync(
      temporaryFilePath,
      'wx'
    );

    fs.writeFileSync(
      fileDescriptor,
      version,
      {
        encoding: 'utf-8',
      }
    );

    /*
     * 确保临时文件内容已经提交给文件系统。
     */
    fs.fsyncSync(fileDescriptor);

    fs.closeSync(fileDescriptor);
    fileDescriptor = null;

    /*
     * 临时文件与正式版本文件位于同一目录。
     * rename 时读取方只会看到完整的旧值或新值。
     */
    fs.renameSync(
      temporaryFilePath,
      VERSION_FILE_PATH
    );

    return version;
  } catch (error) {
    /*
     * 如果写入失败，避免留下临时文件。
     */
    if (fileDescriptor !== null) {
      try {
        fs.closeSync(fileDescriptor);
      } catch {
        // 忽略关闭文件失败。
      }
    }

    try {
      if (
        fs.existsSync(
          temporaryFilePath
        )
      ) {
        fs.unlinkSync(
          temporaryFilePath
        );
      }
    } catch {
      // 忽略临时文件清理失败。
    }

    console.error(
      '原子更新题库版本文件失败：',
      error
    );

    throw error;
  }
}

/**
 * 清空当前模块缓存，并更新磁盘版本。
 *
 * 其他 Next.js 模块实例在下一次 scanAllQuestionsMeta() 时，
 * 会检测到磁盘版本变化并自动重新扫描 Markdown 文件。
 */
export function invalidateMetaCache(): void {
  const previousVersion = cachedBankVersion;
  const previousCount = metaCache?.length ?? 0;

  metaCache = null;
  cachedBankVersion = null;

  const newVersion = touchQuestionBankVersion();

  logCache('缓存已清除', {
    previousVersion,
    previousCount,
    newVersion,
  });
}

function toStringArray(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];

  return values
    .filter(item => item !== null && item !== undefined && item !== '')
    .map(item => (typeof item === 'string' ? item : String(item)));
}

function toSafeNumber(value: unknown, fallback = 0): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function buildLightMeta(
  data: Record<string, unknown>,
  filePath: string
): QuestionMetaLight | null {
  const qid = toSafeNumber(data.qid, Number.NaN);

  if (!Number.isSafeInteger(qid) || qid <= 0) {
    return null;
  }

  return {
    qid,
    grade: typeof data.grade === 'string' ? data.grade : '',
    source: typeof data.source === 'string' ? data.source : '',
    number: typeof data.number === 'string' ? data.number : '',
    type: typeof data.type === 'string' ? data.type : '',
    exam_type: typeof data.exam_type === 'string' ? data.exam_type : '',
    filePath,
    difficulty: toSafeNumber(data.difficulty),
    knowledge: toStringArray(data.knowledge),
    tags: toStringArray(data.tags),
  };
}

function listQuestionFiles(): string[] {
  if (!fs.existsSync(BANK_PATH)) {
    return [];
  }

  const filePaths: string[] = [];
  let sourceDirs: string[];

  try {
    sourceDirs = fs.readdirSync(BANK_PATH);
  } catch (error) {
    console.warn('读取题库目录失败：', error);
    return [];
  }

  for (const dirName of sourceDirs) {
    const dirPath = path.join(BANK_PATH, dirName);

    let directoryStat: fs.Stats;
    try {
      directoryStat = fs.statSync(dirPath);
    } catch {
      continue;
    }

    if (!directoryStat.isDirectory()) continue;

    let files: string[];
    try {
      files = fs.readdirSync(dirPath);
    } catch {
      continue;
    }

    for (const fileName of files) {
      if (!fileName.endsWith('.md') || fileName.endsWith('.bak')) continue;
      filePaths.push(path.join(dirPath, fileName));
    }
  }

  return filePaths;
}

/** 扫描题库，只返回元数据（不含 content 正文）。 */
export function scanAllQuestionsMeta(): QuestionMetaLight[] {
  const versionBeforeScan = getQuestionBankVersion();

  /*
   * 只有内存缓存存在，并且缓存版本与扫描前的磁盘版本一致时才复用。
   * 任何模块调用 invalidateMetaCache() 后，版本文件都会变化，
   * 其他模块实例也将自动放弃自己的旧缓存。
   */
  if (metaCache && cachedBankVersion === versionBeforeScan) {
    logCache('命中缓存', {
      version: versionBeforeScan,
      count: metaCache.length,
    });

    return cloneQuestionMetaList(metaCache);
  }

  logCache('版本变化，重新扫描', {
    cachedVersion: cachedBankVersion,
    currentVersion: versionBeforeScan,
    hadCache: metaCache !== null,
  });

  const scanStartedAt = Date.now();
  const results: QuestionMetaLight[] = [];

  for (const filePath of listQuestionFiles()) {
    let raw: string;

    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
      console.warn(`文件读取失败，跳过: ${filePath}`);
      continue;
    }

    try {
      const parsed = matter(raw);
      const meta = buildLightMeta(
        parsed.data as Record<string, unknown>,
        filePath
      );

      if (meta) {
        results.push(meta);
      }
    } catch {
      console.warn(`YAML 解析失败，跳过: ${filePath}`);
    }
  }

  results.sort((a, b) => b.qid - a.qid);

  const versionAfterScan = getQuestionBankVersion();
  const durationMs = Date.now() - scanStartedAt;

  /*
   * 如果扫描过程中题库版本发生变化，说明本次结果可能处于过渡状态。
   * 本次结果仍可返回给调用方，但绝不写入缓存；下一次请求会重新扫描。
   */
  if (versionBeforeScan !== versionAfterScan) {
    metaCache = null;
    cachedBankVersion = null;

    logCache('扫描期间版本发生变化，本次结果不缓存', {
      versionBeforeScan,
      versionAfterScan,
      count: results.length,
      durationMs,
    });

    return cloneQuestionMetaList(results);
  }

  /*
   * 缓存和返回值分别建立深复制：
   * - 调用方修改题目对象不会污染 metaCache；
   * - 调用方修改 knowledge / tags 数组也不会污染缓存。
   */
  metaCache = cloneQuestionMetaList(results);
  cachedBankVersion = versionAfterScan;

  logCache('扫描完成', {
    version: versionAfterScan,
    count: results.length,
    durationMs,
  });

  return cloneQuestionMetaList(results);
}

/** 扫描题库，返回完整题目（含 content 正文）。 */
export function scanAllQuestions(): QuestionMeta[] {
  const results: QuestionMeta[] = [];

  for (const filePath of listQuestionFiles()) {
    let raw: string;

    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
      console.warn(`文件读取失败，跳过: ${filePath}`);
      continue;
    }

    try {
      const parsed = matter(raw);
      const meta = buildLightMeta(
        parsed.data as Record<string, unknown>,
        filePath
      );

      if (!meta) continue;

      results.push({
        ...meta,
        content: parsed.content.trim(),
      });
    } catch {
      console.warn(`YAML 解析失败，跳过: ${filePath}`);
    }
  }

  results.sort((a, b) => b.qid - a.qid);
  return results;
}

/** 根据 qid 读取单道题的完整内容。 */
export function getQuestionByQid(qid: number): QuestionMeta | null {
  if (!Number.isSafeInteger(qid) || qid <= 0) {
    return null;
  }

  for (const filePath of listQuestionFiles()) {
    let raw: string;

    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    try {
      const parsed = matter(raw);
      const meta = buildLightMeta(
        parsed.data as Record<string, unknown>,
        filePath
      );

      if (meta?.qid === qid) {
        return {
          ...meta,
          content: parsed.content.trim(),
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}
