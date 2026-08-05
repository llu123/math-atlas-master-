'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { QuestionMetaLight } from '@/lib/questions';
import JSZip from 'jszip';

import MathText from '@/components/MathText';
import BrowseView from '@/components/BrowseView';
import { buildLatexHandout } from '@/lib/latex';
import styles from './FilterableTable.module.css';

const PAGE_SIZE = 25;
const BROWSE_PAGE_SIZE = 10;
const BASKET_STORAGE_KEY = 'math-atlas-exam-basket';

type ViewMode = 'table' | 'browse';
type SortField = 'source' | 'number' | 'difficulty' | 'type';
type SortOrder = 'asc' | 'desc';
type QuestionSections = Record<string, string>;
type LoadedContents = Record<number, QuestionSections>;

function parseQuestionNumber(value: string): number {
  const result = Number.parseInt(value.replace(/^[A-Za-z]+/, ''), 10);
  return Number.isNaN(result) ? 0 : result;
}

function createTimestamp(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
}

export default function FilterableTable({
  questions,
}: {
  questions: QuestionMetaLight[];
}) {
  const router = useRouter();

  const [grade, setGrade] = useState('');
  const [source, setSource] = useState('');
  const [questionType, setQuestionType] = useState('');
  const [numberMin, setNumberMin] = useState('');
  const [numberMax, setNumberMax] = useState('');
  const [examType, setExamType] = useState('');
  const [difficultyMin, setDifficultyMin] = useState('');
  const [difficultyMax, setDifficultyMax] = useState('');
  const [knowledge, setKnowledge] = useState('');
  const [tag, setTag] = useState('');
  const [qidInput, setQidInput] = useState('');
  const [page, setPage] = useState(1);
  const [expandedQid, setExpandedQid] = useState<number | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const [selectedQids, setSelectedQids] = useState<Set<number>>(new Set());
  const [basketLoaded, setBasketLoaded] = useState(false);
  const [basketOnly, setBasketOnly] = useState(false);
  const [deletedQids, setDeletedQids] = useState<Set<number>>(new Set());
  const [deletingQid, setDeletingQid] = useState<number | null>(null);
  const [loadedContents, setLoadedContents] = useState<LoadedContents>({});
  const [loadingQid, setLoadingQid] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [sortBy, setSortBy] = useState<SortField>('source');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [refreshingBank, setRefreshingBank] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(BASKET_STORAGE_KEY);
      if (!saved) return;
      const parsed: unknown = JSON.parse(saved);
      if (!Array.isArray(parsed)) return;
      const validQids = parsed
        .map(value => Number(value))
        .filter(value => Number.isFinite(value));
      setSelectedQids(new Set(validQids));
    } catch (error) {
      console.error('读取试题篮失败：', error);
    } finally {
      setBasketLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!basketLoaded) return;
    try {
      window.localStorage.setItem(
        BASKET_STORAGE_KEY,
        JSON.stringify(Array.from(selectedQids))
      );
    } catch (error) {
      console.error('保存试题篮失败：', error);
    }
  }, [selectedQids, basketLoaded]);

  const grades = useMemo(
    () => [...new Set(questions.map(q => q.grade).filter(Boolean))].sort(),
    [questions]
  );
  const sources = useMemo(
    () => [...new Set(questions.map(q => q.source).filter(Boolean))].sort(),
    [questions]
  );
  const questionTypes = useMemo(
    () => [...new Set(questions.map(q => q.type).filter(Boolean))].sort(),
    [questions]
  );
  const examTypes = useMemo(
    () => [...new Set(questions.map(q => q.exam_type).filter(Boolean))].sort(),
    [questions]
  );
  const knowledges = useMemo(
    () => [...new Set(questions.flatMap(q => q.knowledge).filter(Boolean))].sort(),
    [questions]
  );
  const tags = useMemo(
    () => [...new Set(questions.flatMap(q => q.tags).filter(Boolean))].sort(),
    [questions]
  );

  const qidOrder = useMemo(
    () =>
      qidInput
        .split(/[\n, ]+/)
        .map(value => value.trim())
        .filter(Boolean)
        .map(Number)
        .filter(Number.isFinite),
    [qidInput]
  );
  const qidSet = useMemo(() => new Set(qidOrder), [qidOrder]);

  const filtered = useMemo(() => {
    const minNumber = numberMin === '' ? null : Number(numberMin);
    const maxNumber = numberMax === '' ? null : Number(numberMax);
    const minDifficulty = difficultyMin === '' ? null : Number(difficultyMin);
    const maxDifficulty = difficultyMax === '' ? null : Number(difficultyMax);

    const result = questions.filter(question => {
      if (deletedQids.has(question.qid)) return false;
      if (basketOnly && !selectedQids.has(question.qid)) return false;
      if (qidSet.size > 0 && !qidSet.has(question.qid)) return false;
      if (grade && question.grade !== grade) return false;
      if (source && question.source !== source) return false;
      if (questionType && question.type !== questionType) return false;
      if (examType && question.exam_type !== examType) return false;

      const questionNumber = parseQuestionNumber(question.number);
      if (minNumber !== null && questionNumber < minNumber) return false;
      if (maxNumber !== null && questionNumber > maxNumber) return false;
      if (minDifficulty !== null && question.difficulty < minDifficulty) return false;
      if (maxDifficulty !== null && question.difficulty > maxDifficulty) return false;
      if (knowledge && !question.knowledge.includes(knowledge)) return false;
      if (tag && !question.tags.includes(tag)) return false;
      return true;
    });

    if (qidOrder.length > 0) {
      const positions = new Map(qidOrder.map((qid, index) => [qid, index]));
      result.sort(
        (a, b) =>
          (positions.get(a.qid) ?? Infinity) -
          (positions.get(b.qid) ?? Infinity)
      );
      return result;
    }

    const direction = sortOrder === 'asc' ? 1 : -1;
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'number':
          comparison = parseQuestionNumber(a.number) - parseQuestionNumber(b.number);
          break;
        case 'difficulty':
          comparison = (a.difficulty ?? 0) - (b.difficulty ?? 0);
          break;
        case 'type':
          comparison = (a.type || '').localeCompare(b.type || '', 'zh-CN');
          break;
        case 'source':
        default:
          comparison = (a.source || '').localeCompare(b.source || '', 'zh-CN');
      }
      return comparison * direction;
    });
    return result;
  }, [
    questions,
    deletedQids,
    basketOnly,
    selectedQids,
    qidSet,
    qidOrder,
    grade,
    source,
    questionType,
    examType,
    numberMin,
    numberMax,
    difficultyMin,
    difficultyMax,
    knowledge,
    tag,
    sortBy,
    sortOrder,
  ]);

  useEffect(() => {
    setPage(1);
  }, [
    grade,
    source,
    questionType,
    numberMin,
    numberMax,
    examType,
    difficultyMin,
    difficultyMax,
    knowledge,
    tag,
    qidInput,
    viewMode,
    basketOnly,
  ]);

  const pageSize = viewMode === 'browse' ? BROWSE_PAGE_SIZE : PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, safePage, pageSize]);

  const refreshQuestionBank = async () => {
    if (refreshingBank) return;

    setRefreshingBank(true);

    try {
      const response = await fetch('/api/questions/refresh', {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        },
      });

      /*
       * 某些开发环境或旧版刷新接口可能返回空响应。
       * 先读取文本，只有内容非空时才解析 JSON，避免：
       * Unexpected end of JSON input
       */
      const responseText = await response.text();

      let data: {
        ok?: boolean;
        message?: string;
        error?: string;
      } = {};

      if (responseText.trim()) {
        try {
          data = JSON.parse(responseText) as {
            ok?: boolean;
            message?: string;
            error?: string;
          };
        } catch {
          throw new Error(
            `刷新接口返回了无效内容（HTTP ${response.status}）`
          );
        }
      }

      if (!response.ok) {
        throw new Error(
          data.error || `刷新请求失败，HTTP ${response.status}`
        );
      }

      /*
       * 兼容两种成功响应：
       * 1. { ok: true, message: '...' }
       * 2. HTTP 2xx，但响应体为空。
       */
      if (data.ok === false) {
        throw new Error(data.error || '刷新题库失败');
      }

      setLoadedContents({});
      setDeletedQids(new Set());
      setExpandedQid(null);
      setLoadingQid(null);
      setShowAnswer(false);
      setShowSolution(false);

      router.refresh();

      window.alert(data.message || '题库已刷新');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '未知错误';
      window.alert(`刷新题库失败：${message}`);
    } finally {
      setRefreshingBank(false);
    }
  };

  const clearAll = () => {
    setGrade('');
    setSource('');
    setQuestionType('');
    setNumberMin('');
    setNumberMax('');
    setExamType('');
    setDifficultyMin('');
    setDifficultyMax('');
    setKnowledge('');
    setTag('');
    setQidInput('');
  };

  const clearBasket = () => {
    if (selectedQids.size === 0) {
      window.alert('试题篮已经是空的');
      return;
    }
    if (!window.confirm(`确定清空试题篮中的 ${selectedQids.size} 道题目吗？`)) {
      return;
    }
    setSelectedQids(new Set());
    setBasketOnly(false);
  };

  const handoutQuestions = useMemo(() => {
    const availableQuestions = questions.filter(q => !deletedQids.has(q.qid));
    if (selectedQids.size === 0) return filtered;
    return availableQuestions.filter(q => selectedQids.has(q.qid));
  }, [questions, filtered, selectedQids, deletedQids]);

  const fetchMissing = async (qids: number[]): Promise<LoadedContents> => {
    const needed = [...new Set(qids.filter(qid => !loadedContents[qid]))];
    if (needed.length === 0) return loadedContents;

    const results = await Promise.all(
      needed.map(async qid => {
        try {
          const response = await fetch(`/api/questions/${qid}`, {
            cache: 'no-store',
          });
          if (response.ok) {
            const data = await response.json();
            return { qid, sections: data.sections as QuestionSections };
          }
        } catch (error) {
          console.error(`加载题目 ${qid} 失败：`, error);
        }
        return { qid, sections: null as QuestionSections | null };
      })
    );

    const fresh: LoadedContents = {};
    for (const result of results) {
      if (result.sections) fresh[result.qid] = result.sections;
    }
    setLoadedContents(previous => ({ ...previous, ...fresh }));
    return { ...loadedContents, ...fresh };
  };

  const buildHandoutWithImages = async (): Promise<{
    markdown: string;
    imageMap: Map<string, string>;
  }> => {
    const allContents = await fetchMissing(handoutQuestions.map(q => q.qid));
    const imageMap = new Map<string, string>();

    const convertImages = (
      text: string,
      questionNumber: number,
      counter: Map<number, number>
    ): string => {
      const mapImage = (originalFilename: string): string => {
        const existingName = imageMap.get(originalFilename);
        if (existingName) return `![](${existingName})`;
        const extension = originalFilename.split('.').pop() || 'jpg';
        const nextCount = (counter.get(questionNumber) ?? 0) + 1;
        counter.set(questionNumber, nextCount);
        const newName = `${questionNumber}-${nextCount}.${extension}`;
        imageMap.set(originalFilename, newName);
        return `![](${newName})`;
      };

      let converted = text.replace(
        /!\[\[images\/([^\]|]+)(?:\|\d+)?\]\]/g,
        (_, filename: string) => mapImage(filename)
      );
      converted = converted.replace(
        /!\[[^\]]*\]\(images\/([^)]+)\)/g,
        (_, filename: string) => mapImage(filename)
      );
      return converted;
    };

    const markdown = handoutQuestions
      .map((question, index) => {
        const sections = allContents[question.qid];
        const questionNumber = index + 1;
        const imageCounter = new Map<number, number>();
        if (!sections?.['题目']) return `${questionNumber}. （内容加载失败）`;

        let questionText = sections['题目'];
        const type = question.type || '';
        const isMultiSelect = type === '多选题' || questionText.includes('[多选]');
        const isSingleSelect = type === '单选题' || questionText.includes('[选]');
        const prefix = isMultiSelect ? `${questionNumber}.(多选)` : `${questionNumber}.`;

        questionText = questionText
          .replace(/\[多选\]/g, '')
          .replace(/\[选\]/g, '')
          .replace(/\[填\]/g, '____')
          .trim();
        if ((isSingleSelect || isMultiSelect) && !questionText.endsWith('()')) {
          questionText += '()';
        }
        questionText = convertImages(questionText, questionNumber, imageCounter);

        const lines: string[] = [`${prefix} ${questionText}`];
        if ((isSingleSelect || isMultiSelect) && sections['选项']) {
          lines.push(convertImages(sections['选项'], questionNumber, imageCounter));
        }
        if (sections['答案']) {
          lines.push(`【答案】${convertImages(sections['答案'], questionNumber, imageCounter)}`);
        }
        lines.push(`【来源】${question.source}${question.number}`);
        if (sections['我的备注']) {
          lines.push(`【备注】${convertImages(sections['我的备注'], questionNumber, imageCounter)}`);
        }
        const aiNote = sections['AI 备注'] || sections['AI备注'];
        if (aiNote) {
          lines.push(`【AI备注】${convertImages(aiNote, questionNumber, imageCounter)}`);
        }
        if (sections['解析']) {
          lines.push(`【解析】${convertImages(sections['解析'], questionNumber, imageCounter)}`);
        }
        return lines.join('\n');
      })
      .join('\n\n\n');

    return { markdown, imageMap };
  };

  const copyAsMarkdown = async () => {
    const { markdown } = await buildHandoutWithImages();
    await navigator.clipboard.writeText(markdown);
    window.alert(`已复制 ${handoutQuestions.length} 道题目到剪贴板`);
  };

  const downloadZip = async () => {
    const { markdown, imageMap } = await buildHandoutWithImages();
    const zip = new JSZip();
    zip.file('讲义.md', markdown);
    await Promise.all(
      Array.from(imageMap.entries()).map(async ([originalFilename, newName]) => {
        try {
          const response = await fetch(`/api/images/${encodeURIComponent(originalFilename)}`);
          if (response.ok) zip.file(newName, await response.blob());
        } catch (error) {
          console.warn(`图片加载失败：${originalFilename}`, error);
        }
      })
    );
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `讲义_Markdown_${createTimestamp()}.zip`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportToLocal = async () => {
    try {
      const response = await fetch('/api/export-latex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qids: handoutQuestions.map(q => q.qid) }),
      });
      const data = await response.json();
      if (data.ok) {
        window.alert(`已导出 ${data.count} 道题目 → ${data.folder}`);
      } else {
        window.alert(`导出失败：${data.error || '未知错误'}`);
      }
    } catch (error: unknown) {
      window.alert(`导出失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const copyAsLatex = async () => {
    const contents = await fetchMissing(handoutQuestions.map(q => q.qid));
    const { tex } = buildLatexHandout(handoutQuestions, contents);
    await navigator.clipboard.writeText(tex);
    window.alert(`已复制 ${handoutQuestions.length} 道题目的 LaTeX 代码`);
  };

  const downloadLatexZip = async () => {
    const contents = await fetchMissing(handoutQuestions.map(q => q.qid));
    const { tex, imageMap } = buildLatexHandout(handoutQuestions, contents);
    const zip = new JSZip();
    zip.file('讲义.tex', tex);
    try {
      const response = await fetch('/mathatlas.sty');
      if (response.ok) zip.file('mathatlas.sty', await response.text());
    } catch (error) {
      console.warn('获取样式文件失败：', error);
    }
    await Promise.all(
      Array.from(imageMap.entries()).map(async ([originalFilename, newName]) => {
        try {
          const response = await fetch(`/api/images/${encodeURIComponent(originalFilename)}`);
          if (response.ok) zip.file(`images/${newName}`, await response.blob());
        } catch (error) {
          console.warn(`图片加载失败：${originalFilename}`, error);
        }
      })
    );
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `讲义_LaTeX_${createTimestamp()}.zip`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const deleteQuestion = async (question: QuestionMetaLight) => {
    const name = [question.source, question.number].filter(Boolean).join(' ');
    const confirmed = window.confirm(
      `确定删除“${name || question.qid}”吗？\n\n题目 Markdown 文件将移动到回收站，图片不会被删除。`
    );

    if (!confirmed) return;

    setDeletingQid(question.qid);

    try {
      const response = await fetch(`/api/questions/${question.qid}`, {
        method: 'DELETE',
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        },
      });

      const data: {
        ok?: boolean;
        alreadyAbsent?: boolean;
        error?: string;
        message?: string;
        trashFile?: string;
      } = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || '删除题目失败');
      }

      /*
       * 不论文件是刚刚移入回收站，还是此前已经不存在，
       * 都立即从当前表格隐藏该 qid。
       */
      setDeletedQids(previous => {
        const next = new Set(previous);
        next.add(question.qid);
        return next;
      });

      setSelectedQids(previous => {
        const next = new Set(previous);
        next.delete(question.qid);
        return next;
      });

      setExpandedQid(current =>
        current === question.qid ? null : current
      );

      setLoadedContents(previous => {
        const next = { ...previous };
        delete next[question.qid];
        return next;
      });

      if (loadingQid === question.qid) {
        setLoadingQid(null);
      }

      /*
       * API 已更新磁盘版本文件；刷新 Server Component 后，
       * 首页会根据新版本重新扫描 Markdown 题库。
       */
      router.refresh();

      window.alert(
        data.alreadyAbsent
          ? '题目文件已经不存在，旧表格记录已移除。'
          : '题目已移动到回收站。'
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '未知错误';
      window.alert(`删除失败：${message}`);
    } finally {
      setDeletingQid(null);
    }
  };

  const toggleSelect = (qid: number) => {
    setSelectedQids(previous => {
      const next = new Set(previous);
      next.has(qid) ? next.delete(qid) : next.add(qid);
      return next;
    });
  };

  const areAllFilteredSelected = useMemo(
    () => filtered.length > 0 && filtered.every(q => selectedQids.has(q.qid)),
    [filtered, selectedQids]
  );

  const toggleSelectAll = () => {
    setSelectedQids(previous => {
      const next = new Set(previous);
      for (const question of filtered) {
        if (areAllFilteredSelected) next.delete(question.qid);
        else next.add(question.qid);
      }
      return next;
    });
  };

  const handleRowClick = async (qid: number) => {
    if (expandedQid === qid) {
      setExpandedQid(null);
      return;
    }
    setExpandedQid(qid);
    setShowAnswer(false);
    setShowSolution(false);
    if (!loadedContents[qid]) {
      setLoadingQid(qid);
      try {
        await fetchMissing([qid]);
      } finally {
        setLoadingQid(null);
      }
    }
  };

  const pageNumbers = useMemo(() => {
    const result: Array<number | '...'> = [];
    for (let number = 1; number <= totalPages; number += 1) {
      const show =
        number === 1 ||
        number === totalPages ||
        (number >= safePage - 2 && number <= safePage + 2);
      if (show) result.push(number);
      else if (result[result.length - 1] !== '...') result.push('...');
    }
    return result;
  }, [totalPages, safePage]);

  return (
    <div className={styles.container}>
      <div className={styles.qidArea}>
        <label className={styles.qidLabel}>
          手动输入 qid
          <br />
          <textarea
            rows={3}
            className={styles.qidTextarea}
            placeholder={'粘贴 qid，每行一个，或空格/逗号分隔'}
            value={qidInput}
            onChange={event => setQidInput(event.target.value)}
          />
        </label>
      </div>

      <div className={styles.filterBar}>
        <FilterSelect label="年级" value={grade} values={grades} onChange={setGrade} />
        <FilterSelect label="类别" value={examType} values={examTypes} onChange={setExamType} />
        <FilterSelect label="来源" value={source} values={sources} onChange={setSource} />
        <FilterSelect label="题型" value={questionType} values={questionTypes} onChange={setQuestionType} />

        <label className={styles.filterLabel}>
          题号范围
          <span className={styles.rangeGroup}>
            <input className={styles.filterInput} type="number" placeholder="最小" value={numberMin} onChange={e => setNumberMin(e.target.value)} min={1} />
            ~
            <input className={styles.filterInput} type="number" placeholder="最大" value={numberMax} onChange={e => setNumberMax(e.target.value)} min={1} />
          </span>
        </label>

        <label className={styles.filterLabel}>
          难度范围
          <span className={styles.rangeGroup}>
            <input className={styles.filterInput} type="number" placeholder="最小" value={difficultyMin} onChange={e => setDifficultyMin(e.target.value)} min={0} max={1} step={0.1} />
            ~
            <input className={styles.filterInput} type="number" placeholder="最大" value={difficultyMax} onChange={e => setDifficultyMax(e.target.value)} min={0} max={1} step={0.1} />
          </span>
        </label>

        <FilterSelect label="知识点" value={knowledge} values={knowledges} onChange={setKnowledge} />
        <FilterSelect label="标签" value={tag} values={tags} onChange={setTag} />

        <label className={styles.filterLabel}>
          排序
          <span className={styles.rangeGroup}>
            <select className={styles.filterSelect} value={sortBy} onChange={e => setSortBy(e.target.value as SortField)}>
              <option value="source">来源</option>
              <option value="number">题号</option>
              <option value="difficulty">难度</option>
              <option value="type">题型</option>
            </select>
            <button type="button" className={styles.sortToggle} onClick={() => setSortOrder(current => (current === 'asc' ? 'desc' : 'asc'))}>
              {sortOrder === 'asc' ? '↑' : '↓'}
            </button>
          </span>
        </label>

        <button type="button" className={styles.btnClear} onClick={clearAll}>
          清除筛选
        </button>
      </div>

      <div className={styles.viewTabs}>
        <button type="button" className={`${styles.viewTab} ${viewMode === 'table' ? styles.viewTabActive : ''}`} onClick={() => setViewMode('table')}>
          📋 表格
        </button>
        <button type="button" className={`${styles.viewTab} ${viewMode === 'browse' ? styles.viewTabActive : ''}`} onClick={() => setViewMode('browse')}>
          📖 浏览
        </button>
      </div>

      <div className={styles.toolbar}>
        <span className={styles.resultCount}>
          筛选结果：{filtered.length} 道题目 · 试题篮：{selectedQids.size} 道
        </span>
        <button
          type="button"
          className={styles.btnAction}
          onClick={refreshQuestionBank}
          disabled={refreshingBank}
          title="重新扫描磁盘中的 Markdown 题库"
        >
          {refreshingBank ? '刷新中……' : '刷新题库'}
        </button>
        <button type="button" className={styles.btnAction} onClick={() => { window.location.href = '/examBasket'; }}>
          打开试题篮（{selectedQids.size}）
        </button>
        <button type="button" className={styles.btnAction} onClick={() => setBasketOnly(current => !current)} disabled={selectedQids.size === 0}>
          {basketOnly ? '返回全部题目' : '只看试题篮'}
        </button>
        <button type="button" className={styles.btnAction} onClick={clearBasket} disabled={selectedQids.size === 0}>
          清空试题篮
        </button>

        {handoutQuestions.length > 0 && (
          <details className={styles.exportMenu}>
            <summary className={styles.exportMenuButton}>导出与复制</summary>
            <div className={styles.exportMenuPanel}>
              <div className={styles.exportMenuSection}>
                <div className={styles.exportMenuTitle}>Markdown</div>
                <ExportItem icon="📋" title="复制为 Markdown" description="复制题目内容到剪贴板" onClick={copyAsMarkdown} />
                <ExportItem icon="📦" title="下载 Markdown 压缩包" description="包含讲义和题目图片" onClick={downloadZip} />
              </div>
              <div className={styles.exportMenuDivider} />
              <div className={styles.exportMenuSection}>
                <div className={styles.exportMenuTitle}>LaTeX</div>
                <ExportItem icon="𝑇" title="复制为 LaTeX" description="复制 LaTeX 源代码" onClick={copyAsLatex} />
                <ExportItem icon="📦" title="下载 LaTeX 压缩包" description="包含 tex、样式和图片" onClick={downloadLatexZip} />
                <ExportItem icon="📁" title="导出到本地目录" description="保存到项目的 LATEX 目录" onClick={exportToLocal} />
              </div>
            </div>
          </details>
        )}
      </div>

      {viewMode === 'browse' ? (
        <BrowseView
          questions={paginated}
          loadedContents={loadedContents}
          selectedQids={selectedQids}
          loadingQid={loadingQid}
          onToggleSelect={toggleSelect}
          onLoadContent={qid => {
            if (!loadedContents[qid]) {
              setLoadingQid(qid);
              fetchMissing([qid]).finally(() => setLoadingQid(null));
            }
          }}
          onRefresh={qid => {
            setLoadedContents(previous => {
              const next = { ...previous };
              delete next[qid];
              return next;
            });
            setLoadingQid(qid);
            fetchMissing([qid]).finally(() => setLoadingQid(null));
          }}
        />
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input type="checkbox" checked={areAllFilteredSelected} onChange={toggleSelectAll} aria-label="全选当前筛选结果" />
              </th>
              <th>qid</th>
              <th>来源</th>
              <th>题号</th>
              <th>题型</th>
              <th>年级</th>
              <th>类别</th>
              <th>难度</th>
              <th>知识点</th>
              <th>标签</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map(question => {
              const isExpanded = expandedQid === question.qid;
              const sections = loadedContents[question.qid];
              const isLoading = loadingQid === question.qid;
              return (
                <Fragment key={question.qid}>
                  <tr className={isExpanded ? styles.expandedRow : undefined} onClick={() => handleRowClick(question.qid)}>
                    <td onClick={event => event.stopPropagation()}>
                      <input type="checkbox" checked={selectedQids.has(question.qid)} onChange={() => toggleSelect(question.qid)} />
                    </td>
                    <td>{question.qid}</td>
                    <td>{question.source}</td>
                    <td>{question.number}</td>
                    <td>{question.type}</td>
                    <td>{question.grade}</td>
                    <td>{question.exam_type}</td>
                    <td>{question.difficulty}</td>
                    <td>{question.knowledge.join('、')}</td>
                    <td>{question.tags.join('、')}</td>
                    <td onClick={event => event.stopPropagation()}>
                      <button
                        type="button"
                        className={styles.btnDeleteQuestion}
                        disabled={deletingQid === question.qid}
                        onClick={() => deleteQuestion(question)}
                      >
                        {deletingQid === question.qid ? '删除中……' : '删除'}
                      </button>
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr>
                      <td colSpan={11} style={{ padding: '1.5rem', border: 'none' }}>
                        <div className={styles.detail} style={{ marginTop: 0 }}>
                          <div className={styles.detailMeta}>
                            <strong>{question.source}</strong> · {question.number} · {question.type} · {question.grade} · {question.exam_type} · 难度 {question.difficulty}
                          </div>
                          {isLoading && <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>加载中……</div>}
                          {sections && (
                            <>
                              {sections['题目'] && <DetailSection title="题目"><MathText text={sections['题目']} /></DetailSection>}
                              {sections['选项'] && <DetailSection title="选项"><MathText text={sections['选项']} /></DetailSection>}
                              {sections['我的备注'] && (
                                <div className={`${styles.detailNote} ${styles.detailNoteMine}`}>
                                  <h3>我的备注</h3>
                                  <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, color: 'var(--text)' }}>{sections['我的备注']}</pre>
                                </div>
                              )}
                              {(sections['AI 备注'] || sections['AI备注']) && (
                                <div className={`${styles.detailNote} ${styles.detailNoteAI}`}>
                                  <h3>AI 备注</h3>
                                  <MathText text={sections['AI 备注'] || sections['AI备注']} />
                                </div>
                              )}
                              {sections['答案'] && (
                                <div className={styles.detailSection}>
                                  <h3 className={styles.detailFold} onClick={() => setShowAnswer(current => !current)}>
                                    {showAnswer ? '▼' : '▶'} 答案
                                  </h3>
                                  {showAnswer && <MathText text={sections['答案']} />}
                                </div>
                              )}
                              {sections['解析'] && (
                                <div className={styles.detailSection}>
                                  <h3 className={styles.detailFold} onClick={() => setShowSolution(current => !current)}>
                                    {showSolution ? '▼' : '▶'} 解析
                                  </h3>
                                  {showSolution && <MathText text={sections['解析']} />}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button type="button" className={styles.pageBtn} disabled={safePage <= 1} onClick={() => setPage(current => Math.max(1, current - 1))}>
            上一页
          </button>
          {pageNumbers.map((pageNumber, index) =>
            pageNumber === '...' ? (
              <span key={`ellipsis-${index}`} className={styles.pageEllipsis}>…</span>
            ) : (
              <button type="button" key={pageNumber} className={`${styles.pageBtn} ${pageNumber === safePage ? styles.pageActive : ''}`} onClick={() => setPage(pageNumber)}>
                {pageNumber}
              </button>
            )
          )}
          <button type="button" className={styles.pageBtn} disabled={safePage >= totalPages} onClick={() => setPage(current => Math.min(totalPages, current + 1))}>
            下一页
          </button>
          <span className={styles.pageInfo}>第 {safePage}/{totalPages} 页</span>
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.filterLabel}>
      {label}
      <select className={styles.filterSelect} value={value} onChange={event => onChange(event.target.value)}>
        <option value="">全部</option>
        {values.map(item => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
  );
}

function ExportItem({
  icon,
  title,
  description,
  onClick,
}: {
  icon: string;
  title: string;
  description: string;
  onClick: () => void | Promise<void>;
}) {
  return (
    <button type="button" className={styles.exportMenuItem} onClick={onClick}>
      <span className={styles.exportMenuIcon}>{icon}</span>
      <span><strong>{title}</strong><small>{description}</small></span>
    </button>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.detailSection}>
      <h3>{title}</h3>
      {children}
    </div>
  );
}
