import {
  scanAllQuestionsMeta,
} from '../lib/questions';

import FilterableTable from '../components/FilterableTable';
import ThemeToggle from '../components/ThemeToggle';

/*
 * 题库由本地 Markdown 文件驱动，
 * 不适合把首页长期静态缓存。
 *
 * 每次重新请求首页时，都重新执行服务端页面。
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function Home() {
  const questions = scanAllQuestionsMeta();

  return (
    <main style={{ padding: '2rem' }}>
      <ThemeToggle />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1.5rem',
          marginBottom: '0.5rem',
        }}
      >
        <h1 style={{ margin: 0 }}>MathAtlas</h1>

        <a
          href="/add"
          style={{
            textDecoration: 'none',
          }}
        >
          + 添加题目
        </a>
      </div>

      <p>共 {questions.length} 道题目</p>

      <FilterableTable questions={questions} />
    </main>
  );
}