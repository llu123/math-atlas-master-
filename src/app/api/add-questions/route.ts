import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

import { invalidateMetaCache } from '@/lib/questions';

const VAULT_PATH = process.env.VAULT_PATH || './demo-vault';
const BANK_PATH = path.join(VAULT_PATH, '题库');

let lastGeneratedQid = 0;

interface QuestionInput {
  content: string;
  source: string;
  number: string;
  type: string;
  grade?: string;
  semester?: string;
  exam_type?: string;
  difficulty?: number | null;
  knowledge?: string[];
  tags?: string[];
}

interface AddQuestionsRequest {
  questions?: QuestionInput[];
  action?: 'check' | 'write';
  onConflict?: 'skip' | 'overwrite';
}

interface QuestionWriteResult {
  qid: number;
  number: string;
  source: string;
  skipped?: boolean;
  error?: string;
}

function generateQid(): number {
  const timestampBase = Date.now() * 1000;
  const qid = Math.max(timestampBase, lastGeneratedQid + 1);

  if (!Number.isSafeInteger(qid)) {
    throw new Error('生成的 qid 超出 JavaScript 安全整数范围');
  }

  lastGeneratedQid = qid;
  return qid;
}

function buildFilePath(
  source: string,
  number: string,
  qid?: number
): string {
  const safeSource = typeof source === 'string' ? source.trim() : '';
  const safeNumber = typeof number === 'string' ? number.trim() : '';
  const directoryName = safeSource || '未分类';
  const nameParts = [safeSource, safeNumber].filter(Boolean);
  const baseName = nameParts.length > 0 ? nameParts.join('-') : String(qid);

  return path.join(BANK_PATH, directoryName, `${baseName}.md`);
}

function removeExistingFrontmatter(content: string): string {
  let cleanContent = typeof content === 'string' ? content.trim() : '';
  cleanContent = cleanContent.replace(/\r\n/g, '\n');

  if (cleanContent.startsWith('---\n')) {
    const endIndex = cleanContent.indexOf('\n---\n', 4);

    if (endIndex !== -1) {
      cleanContent = cleanContent.slice(endIndex + 5).trim();
    }
  }

  return cleanContent;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeQuestion(question: QuestionInput): QuestionInput {
  return {
    content: typeof question.content === 'string' ? question.content : '',
    source: typeof question.source === 'string' ? question.source.trim() : '',
    number: typeof question.number === 'string' ? question.number.trim() : '',
    type: typeof question.type === 'string' ? question.type.trim() : '',
    grade: typeof question.grade === 'string' ? question.grade.trim() : '',
    semester:
      typeof question.semester === 'string' ? question.semester.trim() : '',
    exam_type:
      typeof question.exam_type === 'string' ? question.exam_type.trim() : '',
    difficulty:
      typeof question.difficulty === 'number' &&
      Number.isFinite(question.difficulty)
        ? question.difficulty
        : null,
    knowledge: normalizeStringArray(question.knowledge),
    tags: normalizeStringArray(question.tags),
  };
}

export async function POST(request: NextRequest) {
  let body: AddQuestionsRequest;

  try {
    body = (await request.json()) as AddQuestionsRequest;
  } catch {
    return Response.json(
      { error: '请求内容不是有效的 JSON' },
      {
        status: 400,
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      }
    );
  }

  const { questions, action = 'write', onConflict } = body;

  if (!Array.isArray(questions) || questions.length === 0) {
    return Response.json(
      { error: '缺少题目数据' },
      {
        status: 400,
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      }
    );
  }

  if (action === 'check') {
    const conflicts: Array<{
      index: number;
      number: string;
      source: string;
      fileName: string;
    }> = [];

    const dummyQid = Date.now() * 1000;

    for (let index = 0; index < questions.length; index += 1) {
      const question = normalizeQuestion(questions[index]);
      const filePath = buildFilePath(
        question.source,
        question.number,
        dummyQid + index
      );

      if (fs.existsSync(filePath)) {
        conflicts.push({
          index,
          number: question.number,
          source: question.source,
          fileName: path.basename(filePath),
        });
      }
    }

    return Response.json(
      { conflicts },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }

  if (action !== 'write') {
    return Response.json(
      { error: '无效的 action，只支持 check 或 write' },
      {
        status: 400,
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      }
    );
  }

  if (!fs.existsSync(BANK_PATH)) {
    fs.mkdirSync(BANK_PATH, { recursive: true });
  }

  const results: QuestionWriteResult[] = [];
  let changedCount = 0;

  for (const input of questions) {
    const question = normalizeQuestion(input);

    try {
      const qid = generateQid();
      const filePath = buildFilePath(
        question.source,
        question.number,
        qid
      );
      const fileExists = fs.existsSync(filePath);

      if (fileExists && onConflict === 'skip') {
        results.push({
          qid,
          number: question.number,
          source: question.source,
          skipped: true,
        });
        continue;
      }

      if (fileExists && onConflict !== 'overwrite') {
        results.push({
          qid,
          number: question.number,
          source: question.source,
          error: '文件已经存在，请选择跳过或覆盖',
        });
        continue;
      }

      const yaml: Record<string, unknown> = {
        qid,
        grade: question.grade || '高中',
        source: question.source,
        number: question.number,
        type: question.type,
        difficulty: question.difficulty ?? '',
        semester: question.semester || '',
        exam_type: question.exam_type || '',
        knowledge: question.knowledge || [],
        ai_tags: [],
        tags: question.tags || [],
        status: '待入库',
        selected: false,
      };

      const cleanContent = removeExistingFrontmatter(question.content);
      const frontmatter = matter.stringify(cleanContent, yaml);
      const outputDirectory = path.dirname(filePath);

      if (!fs.existsSync(outputDirectory)) {
        fs.mkdirSync(outputDirectory, { recursive: true });
      }

      fs.writeFileSync(filePath, frontmatter, 'utf-8');
      changedCount += 1;

      results.push({
        qid,
        number: question.number,
        source: question.source,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '未知错误';

      results.push({
        qid: 0,
        number: question.number,
        source: question.source,
        error: message,
      });
    }
  }

  /*
   * 新版 invalidateMetaCache() 不仅清空当前模块缓存，
   * 还会更新 demo-vault/.math-atlas-version。
   * 其他 Next.js 模块实例会在下次扫描时发现版本变化并自动重读题库。
   */
  if (changedCount > 0) {
    invalidateMetaCache();
    revalidatePath('/');
  }

  return Response.json(
    {
      results,
      changedCount,
    },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    }
  );
}
