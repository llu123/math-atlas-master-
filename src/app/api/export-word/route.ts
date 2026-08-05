import { NextRequest } from 'next/server';
import {
  execFile,
  type ExecFileException,
} from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import {
  getQuestionByQid,
  parseSections,
} from '@/lib/questions';

const execFileAsync = promisify(execFile);

const VAULT_PATH =
  process.env.VAULT_PATH || './demo-vault';

const IMAGE_PATH = path.join(
  VAULT_PATH,
  'images'
);

interface ExportWordRequest {
  title?: string;
  qids?: number[];
  scores?: Record<string, number>;
  includeAnswers?: boolean;
  includeSolutions?: boolean;
}

function sanitizeFilename(value: string): string {
  const result = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .trim();

  return result || '数学试卷';
}

function findPandocPath(): string {
  if (process.env.PANDOC_PATH) {
    return process.env.PANDOC_PATH;
  }

  const candidates = [
    path.join(
      process.cwd(),
      'tool',
      'pandoc',
      'pandoc.exe'
    ),
    path.join(
      process.cwd(),
      'tool',
      'pandoc-3.10',
      'pandoc.exe'
    ),
    path.join(
      process.cwd(),
      'src',
      'tool',
      'pandoc-3.10',
      'pandoc.exe'
    ),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  /*
   * 如果 Pandoc 已加入系统 PATH，
   * Windows、macOS 和 Linux 都可以直接使用 pandoc。
   */
  return 'pandoc';
}

function convertImageReferences(
  text: string
): string {
  /*
   * Obsidian 图片：
   * ![[images/hash.jpg|342]]
   *
   * 转换为普通 Markdown：
   * 绝对图片路径
   */
  let result = text.replace(
    /!\[\[images\/([^\]|]+)(?:\|\d+)?\]\]/g,
    (_match, filename: string) => {
      const absolutePath = path
        .resolve(IMAGE_PATH, filename)
        .replace(/\\/g, '/');

      return `${absolutePath}`;
    }
  );

  /*
   * 普通 Markdown 图片：
   * images/hash.jpg
   */
  result = result.replace(
    /!\[([^\]]*)\]\(images\/([^)]+)\)/g,
    (
      _match,
      alt: string,
      filename: string
    ) => {
      const absolutePath = path
        .resolve(IMAGE_PATH, filename)
        .replace(/\\/g, '/');

      return `${absolutePath}`;
    }
  );

  return result;
}

function cleanQuestionText(text: string): string {
  return text
    .replace(/\[多选\]/g, '')
    .replace(/\[选\]/g, '')
    .replace(/\[填\]/g, '________')
    .trim();
}

function buildWordMarkdown({
  title,
  qids,
  scores,
  includeAnswers,
  includeSolutions,
}: {
  title: string;
  qids: number[];
  scores: Record<string, number>;
  includeAnswers: boolean;
  includeSolutions: boolean;
}): string {
  const questionBlocks: string[] = [];
  const answerBlocks: string[] = [];

  for (
    let index = 0;
    index < qids.length;
    index += 1
  ) {
    const qid = qids[index];
    const question = getQuestionByQid(qid);

    if (!question) {
      questionBlocks.push(
        `${index + 1}. （题目不存在或已经删除）`
      );

      continue;
    }

    const sections = parseSections(
      question.content
    );

    const score =
      scores[String(qid)] ??
      scores[qid as unknown as string] ??
      5;

    const questionText = convertImageReferences(
      cleanQuestionText(
        sections['题目'] || '暂无题干'
      )
    );

    const options = sections['选项']
      ? convertImageReferences(
          sections['选项']
        )
      : '';

    const lines: string[] = [];

    lines.push(
      `## ${index + 1}. （${score} 分）`
    );

    lines.push(questionText);

    if (options) {
      lines.push(options);
    }

    questionBlocks.push(
      lines.join('\n\n')
    );

    if (
      includeAnswers ||
      includeSolutions
    ) {
      const answerLines: string[] = [];

      answerLines.push(
        `## ${index + 1}.`
      );

      if (
        includeAnswers &&
        sections['答案']
      ) {
        answerLines.push(
          `**答案：** ${convertImageReferences(
            sections['答案']
          )}`
        );
      }

      if (
        includeSolutions &&
        sections['解析']
      ) {
        answerLines.push(
          `**解析：**\n\n${convertImageReferences(
            sections['解析']
          )}`
        );
      }

      if (answerLines.length > 1) {
        answerBlocks.push(
          answerLines.join('\n\n')
        );
      }
    }
  }

  const totalScore = qids.reduce(
    (total, qid) => {
      return (
        total +
        (
          scores[String(qid)] ??
          scores[
            qid as unknown as string
          ] ??
          5
        )
      );
    },
    0
  );

  const documentParts: string[] = [
    `# ${title}`,
    [
      '姓名：________________',
      '班级：________________',
      '得分：________________',
    ].join('　　'),
    `共 ${qids.length} 道题，满分 ${totalScore} 分`,
    '---',
    ...questionBlocks,
  ];

  if (answerBlocks.length > 0) {
    documentParts.push(
      '\\newpage',
      '# 参考答案与解析',
      ...answerBlocks
    );
  }

  return documentParts.join('\n\n');
}

export async function POST(
  request: NextRequest
) {
  let temporaryDirectory = '';

  try {
    const body =
      (await request.json()) as ExportWordRequest;

    const title =
      typeof body.title === 'string' &&
      body.title.trim()
        ? body.title.trim()
        : '数学试卷';

    const qids = Array.isArray(body.qids)
      ? body.qids
          .map(value => Number(value))
          .filter(value =>
            Number.isFinite(value)
          )
      : [];

    const scores =
      body.scores &&
      typeof body.scores === 'object'
        ? body.scores
        : {};

    const includeAnswers =
      body.includeAnswers === true;

    const includeSolutions =
      body.includeSolutions === true;

    if (qids.length === 0) {
      return Response.json(
        {
          error: '试题篮为空，无法导出 Word',
        },
        {
          status: 400,
        }
      );
    }

    temporaryDirectory =
      fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          'math-atlas-word-'
        )
      );

    const markdownPath = path.join(
      temporaryDirectory,
      '试卷.md'
    );

    const wordPath = path.join(
      temporaryDirectory,
      '试卷.docx'
    );

    const markdown = buildWordMarkdown({
      title,
      qids,
      scores,
      includeAnswers,
      includeSolutions,
    });

    fs.writeFileSync(
      markdownPath,
      markdown,
      'utf-8'
    );

    const pandocPath = findPandocPath();

    await execFileAsync(
      pandocPath,
      [
        markdownPath,
        '--from=markdown+tex_math_dollars',
        '--to=docx',
        '--standalone',
        `--resource-path=${path.resolve(
          IMAGE_PATH
        )}`,
        '--output',
        wordPath,
      ],
      {
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    if (!fs.existsSync(wordPath)) {
      throw new Error(
        'Pandoc 未生成 Word 文件'
      );
    }

    const wordBuffer =
      fs.readFileSync(wordPath);

    const filename =
      `${sanitizeFilename(title)}.docx`;

    return new Response(wordBuffer, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',

        'Content-Disposition':
          `attachment; filename="exam.docx"; filename*=UTF-8''${encodeURIComponent(
            filename
          )}`,

        'Content-Length':
          String(wordBuffer.length),
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : '未知错误';

    const processError =
      error as ExecFileException;

    console.error(
      'Word 导出失败：',
      error
    );

    const pandocMissing =
      processError.code === 'ENOENT' ||
      message.includes('ENOENT') ||
      message.includes('pandoc');

    return Response.json(
      {
        error: pandocMissing
          ? '没有找到 Pandoc。请安装 Pandoc，或在 .env.local 中配置 PANDOC_PATH。'
          : `Word 导出失败：${message}`,
      },
      {
        status: 500,
      }
    );
  } finally {
    if (
      temporaryDirectory &&
      fs.existsSync(temporaryDirectory)
    ) {
      try {
        fs.rmSync(
          temporaryDirectory,
          {
            recursive: true,
            force: true,
          }
        );
      } catch (error) {
        console.warn(
          '临时文件清理失败：',
          error
        );
      }
    }
  }
}