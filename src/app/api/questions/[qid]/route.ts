import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import fs from 'fs';
import path from 'path';

import {
  getQuestionByQid,
  invalidateMetaCache,
  parseSections,
} from '@/lib/questions';

const VAULT_PATH = process.env.VAULT_PATH || './demo-vault';
const BANK_PATH = path.join(VAULT_PATH, '题库');
const TRASH_PATH = path.join(VAULT_PATH, '.math-atlas-trash');

interface RouteContext {
  params: Promise<{
    qid: string;
  }>;
}

function noStoreHeaders(): HeadersInit {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
  };
}

function parseQid(value: string): number | null {
  const qid = Number(value);

  if (!Number.isSafeInteger(qid) || qid <= 0) {
    return null;
  }

  return qid;
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);

  return (
    relativePath !== '' &&
    !relativePath.startsWith('..') &&
    !path.isAbsolute(relativePath)
  );
}

function createTrashFilePath(
  sourceFilePath: string,
  source: string,
  qid: number
): string {
  const originalFilename = path.basename(sourceFilePath);
  const originalExtension = path.extname(originalFilename);
  const extension = originalExtension || '.md';
  const filenameWithoutExtension = path.basename(
    originalFilename,
    originalExtension
  );
  const safeSource = (source || '未分类').replace(/[<>:"/\\|?*]/g, '_');
  const timestamp = Date.now();

  return path.join(
    TRASH_PATH,
    `${safeSource}-${filenameWithoutExtension}-${qid}-${timestamp}${extension}`
  );
}

function refreshQuestionList(): void {
  /*
   * 新版 invalidateMetaCache() 会同时更新磁盘版本文件。
   * 其他 Next.js 模块实例会在下次扫描时检测到版本变化。
   */
  invalidateMetaCache();
  revalidatePath('/');
}

/** 获取单道题目的完整内容。 */
export async function GET(
  _request: NextRequest,
  { params }: RouteContext
) {
  const { qid: qidText } = await params;
  const qid = parseQid(qidText);

  if (qid === null) {
    return Response.json(
      { error: '无效的 qid' },
      { status: 400, headers: noStoreHeaders() }
    );
  }

  const question = getQuestionByQid(qid);

  if (!question) {
    return Response.json(
      { error: '没有找到这道题' },
      { status: 404, headers: noStoreHeaders() }
    );
  }

  return Response.json(
    {
      qid: question.qid,
      source: question.source,
      number: question.number,
      filePath: question.filePath,
      sections: parseSections(question.content),
    },
    { headers: noStoreHeaders() }
  );
}

/**
 * 删除单道题目。
 *
 * 文件不会永久删除，而是移动到：
 * demo-vault/.math-atlas-trash
 */
export async function DELETE(
  _request: NextRequest,
  { params }: RouteContext
) {
  const { qid: qidText } = await params;
  const qid = parseQid(qidText);

  if (qid === null) {
    return Response.json(
      { error: '无效的 qid' },
      { status: 400, headers: noStoreHeaders() }
    );
  }

  const question = getQuestionByQid(qid);

  if (!question) {
    /*
     * 前端可能仍显示服务端旧页面中的题目，但磁盘文件已经不存在。
     * 对删除操作而言，这属于“目标状态已达成”，因此返回 ok: true，
     * 让前端立即移除旧行，而不是停留在“删除中”。
     */
    refreshQuestionList();

    return Response.json(
      {
        ok: true,
        alreadyAbsent: true,
        qid,
        message: '题目已经不存在，已刷新题库列表',
      },
      { headers: noStoreHeaders() }
    );
  }

  const bankRoot = path.resolve(BANK_PATH);
  const sourceFilePath = path.resolve(question.filePath);

  if (!isPathInside(bankRoot, sourceFilePath)) {
    return Response.json(
      { error: '题目文件不在题库目录中，拒绝删除' },
      { status: 403, headers: noStoreHeaders() }
    );
  }

  if (path.extname(sourceFilePath).toLowerCase() !== '.md') {
    return Response.json(
      { error: '只允许删除 Markdown 题目文件' },
      { status: 403, headers: noStoreHeaders() }
    );
  }

  if (!fs.existsSync(sourceFilePath)) {
    refreshQuestionList();

    return Response.json(
      {
        ok: true,
        alreadyAbsent: true,
        qid,
        message: '题目文件已经不存在，已刷新题库列表',
      },
      { headers: noStoreHeaders() }
    );
  }

  try {
    fs.mkdirSync(TRASH_PATH, { recursive: true });

    let trashFilePath = createTrashFilePath(
      sourceFilePath,
      question.source,
      qid
    );

    let suffix = 1;
    while (fs.existsSync(trashFilePath)) {
      const extension = path.extname(trashFilePath);
      const stem = path.basename(trashFilePath, extension);

      trashFilePath = path.join(
        TRASH_PATH,
        `${stem}-${suffix}${extension}`
      );
      suffix += 1;
    }

    fs.renameSync(sourceFilePath, trashFilePath);
    refreshQuestionList();

    return Response.json(
      {
        ok: true,
        alreadyAbsent: false,
        qid,
        source: question.source,
        number: question.number,
        originalFile: sourceFilePath,
        trashFile: trashFilePath,
        message: '题目已移动到回收站',
      },
      { headers: noStoreHeaders() }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';

    console.error(`删除题目 ${qid} 失败：`, error);

    return Response.json(
      { error: `删除失败：${message}` },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
