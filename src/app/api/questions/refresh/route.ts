import { revalidatePath } from 'next/cache';

import {
  getQuestionBankVersion,
  invalidateMetaCache,
} from '@/lib/questions';

function noStoreHeaders(): HeadersInit {
  return {
    'Cache-Control':
      'no-store, no-cache, must-revalidate, max-age=0',

    Pragma: 'no-cache',

    Expires: '0',
  };
}

/*
 * POST /api/questions/refresh
 *
 * 手动清除题库缓存并更新磁盘版本文件。
 */
export async function POST() {
  try {
    /*
     * invalidateMetaCache() 会：
     *
     * 1. 清除当前模块的内存缓存；
     * 2. 更新 demo-vault/.math-atlas-version；
     * 3. 让其他 Next.js 模块实例检测到版本变化。
     */
    invalidateMetaCache();

    /*
     * 使题库首页的 Server Component 缓存失效。
     */
    revalidatePath('/');

    const version =
      getQuestionBankVersion();

    return Response.json(
      {
        ok: true,
        message: '题库缓存已清除，题库已重新加载',
        version,
      },
      {
        status: 200,
        headers: noStoreHeaders(),
      }
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : '未知错误';

    console.error(
      '手动刷新题库失败：',
      error
    );

    return Response.json(
      {
        ok: false,
        error:
          `刷新题库失败：${message}`,
      },
      {
        status: 500,
        headers: noStoreHeaders(),
      }
    );
  }
}