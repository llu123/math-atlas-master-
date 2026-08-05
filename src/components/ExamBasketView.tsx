"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import type { QuestionMetaLight } from "@/lib/questions";
import MathText from "@/components/MathText";

const BASKET_STORAGE_KEY = "math-atlas-exam-basket";
const BASKET_SCORES_STORAGE_KEY = "math-atlas-exam-basket-scores";
const PAPER_TITLE_STORAGE_KEY = "math-atlas-paper-title";

interface ExamBasketViewProps {
  questions: QuestionMetaLight[];
}

type QuestionScores = Record<number, number>;
type QuestionSections = Record<string, string>;

interface QuestionPreview {
  qid: number;
  text: string;
  x: number;
  y: number;
}

function readStoredQids(): number[] {
  try {
    const saved = window.localStorage.getItem(BASKET_STORAGE_KEY);
    if (!saved) return [];

    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(value => Number(value))
      .filter(value => Number.isFinite(value));
  } catch (error) {
    console.error("读取试题篮失败：", error);
    return [];
  }
}

function readStoredScores(): QuestionScores {
  try {
    const saved = window.localStorage.getItem(BASKET_SCORES_STORAGE_KEY);
    if (!saved) return {};

    const parsed: unknown = JSON.parse(saved);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }

    const scores: QuestionScores = {};
    for (const [qid, score] of Object.entries(parsed)) {
      const numericQid = Number(qid);
      const numericScore = Number(score);

      if (Number.isFinite(numericQid) && Number.isFinite(numericScore)) {
        scores[numericQid] = numericScore;
      }
    }

    return scores;
  } catch (error) {
    console.error("读取题目分值失败：", error);
    return {};
  }
}

function getDownloadFilename(
  contentDisposition: string | null,
  fallback: string
): string {
  if (!contentDisposition) return fallback;

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return fallback;
    }
  }

  const normalMatch = contentDisposition.match(/filename="?([^";]+)"?/);
  return normalMatch?.[1] || fallback;
}

function createPreviewText(text: string): string {
  return text
    .replace(/!\[\[images\/([^\]|]+)(?:\|\d+)?\]\]/g, "[图片]")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "[图片]")
    .replace(/\[多选\]/g, "")
    .replace(/\[选\]/g, "")
    .replace(/\[填\]/g, "____")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export default function ExamBasketView({ questions }: ExamBasketViewProps) {
  const [basketQids, setBasketQids] = useState<number[]>([]);
  const [scores, setScores] = useState<QuestionScores>({});
  const [paperTitle, setPaperTitle] = useState("数学练习卷");
  const [loaded, setLoaded] = useState(false);

  const [includeAnswersInWord, setIncludeAnswersInWord] = useState(false);
  const [includeSolutionsInWord, setIncludeSolutionsInWord] = useState(false);
  const [exportingWord, setExportingWord] = useState(false);

  const [questionPreview, setQuestionPreview] =
    useState<QuestionPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewCacheRef = useRef<Record<number, string>>({});
  const hoveredQidRef = useRef<number | null>(null);

  useEffect(() => {
    const storedQids = readStoredQids();
    const storedScores = readStoredScores();
    const storedTitle = window.localStorage.getItem(PAPER_TITLE_STORAGE_KEY);

    setBasketQids(storedQids);
    setScores(storedScores);
    if (storedTitle) setPaperTitle(storedTitle);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    window.localStorage.setItem(BASKET_STORAGE_KEY, JSON.stringify(basketQids));
  }, [basketQids, loaded]);

  useEffect(() => {
    if (!loaded) return;
    window.localStorage.setItem(
      BASKET_SCORES_STORAGE_KEY,
      JSON.stringify(scores)
    );
  }, [scores, loaded]);

  useEffect(() => {
    if (!loaded) return;
    window.localStorage.setItem(PAPER_TITLE_STORAGE_KEY, paperTitle);
  }, [paperTitle, loaded]);

  useEffect(() => {
    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    };
  }, []);

  const questionMap = useMemo(
    () => new Map(questions.map(question => [question.qid, question])),
    [questions]
  );

  const basketQuestions = useMemo(
    () =>
      basketQids
        .map(qid => questionMap.get(qid))
        .filter(
          (question): question is QuestionMetaLight => question !== undefined
        ),
    [basketQids, questionMap]
  );

  const totalScore = useMemo(
    () =>
      basketQuestions.reduce(
        (total, question) => total + (scores[question.qid] ?? 5),
        0
      ),
    [basketQuestions, scores]
  );

  const updateScore = (qid: number, value: string) => {
    const numericScore = Number(value);
    if (!Number.isFinite(numericScore) || numericScore < 0) return;

    setScores(previous => ({
      ...previous,
      [qid]: numericScore,
    }));
  };

  const handleQuestionMouseEnter = (
    question: QuestionMetaLight,
    event: MouseEvent<HTMLTableRowElement>
  ) => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);

    hoveredQidRef.current = question.qid;
    const mouseX = event.clientX;
    const mouseY = event.clientY;

    previewTimerRef.current = setTimeout(async () => {
      if (hoveredQidRef.current !== question.qid) return;

      const cachedText = previewCacheRef.current[question.qid];
      if (cachedText) {
        setQuestionPreview({
          qid: question.qid,
          text: cachedText,
          x: mouseX,
          y: mouseY,
        });
        return;
      }

      setPreviewLoading(true);
      try {
        const response = await fetch(`/api/questions/${question.qid}`);
        const data: { sections?: QuestionSections; error?: string } =
          await response.json();

        if (!response.ok || !data.sections) {
          throw new Error(data.error || "题干加载失败");
        }

        if (hoveredQidRef.current !== question.qid) return;

        const previewText = createPreviewText(
          data.sections["题目"] || "暂无题干内容"
        );
        previewCacheRef.current[question.qid] = previewText;
        setQuestionPreview({
          qid: question.qid,
          text: previewText,
          x: mouseX,
          y: mouseY,
        });
      } catch (error) {
        console.error("加载题干预览失败：", error);
      } finally {
        setPreviewLoading(false);
      }
    }, 650);
  };

  const handleQuestionMouseMove = (event: MouseEvent<HTMLTableRowElement>) => {
    setQuestionPreview(current =>
      current
        ? {
            ...current,
            x: event.clientX,
            y: event.clientY,
          }
        : current
    );
  };

  const handleQuestionMouseLeave = () => {
    hoveredQidRef.current = null;
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    setQuestionPreview(null);
    setPreviewLoading(false);
  };

  const removeQuestion = (qid: number) => {
    handleQuestionMouseLeave();
    setBasketQids(previous => previous.filter(item => item !== qid));
    setScores(previous => {
      const next = { ...previous };
      delete next[qid];
      return next;
    });
    delete previewCacheRef.current[qid];
  };

  const moveQuestionToTop = (currentIndex: number) => {
    if (currentIndex <= 0) return;

    handleQuestionMouseLeave();

    setBasketQids(previous => {
      if (currentIndex >= previous.length) return previous;

      const next = [...previous];
      const [qid] = next.splice(currentIndex, 1);
      next.unshift(qid);
      return next;
    });
  };

  const moveQuestionToBottom = (currentIndex: number) => {
    handleQuestionMouseLeave();

    setBasketQids(previous => {
      if (
        currentIndex < 0 ||
        currentIndex >= previous.length - 1
      ) {
        return previous;
      }

      const next = [...previous];
      const [qid] = next.splice(currentIndex, 1);
      next.push(qid);
      return next;
    });
  };

  const moveQuestion = (currentIndex: number, direction: -1 | 1) => {
    setBasketQids(previous => {
      const targetIndex = currentIndex + direction;
      if (targetIndex < 0 || targetIndex >= previous.length) return previous;

      const next = [...previous];
      [next[currentIndex], next[targetIndex]] = [
        next[targetIndex],
        next[currentIndex],
      ];
      return next;
    });
  };

  const exportWord = async () => {
    if (basketQids.length === 0) {
      window.alert("试题篮为空，无法导出 Word");
      return;
    }

    setExportingWord(true);
    try {
      const response = await fetch("/api/export-word", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: paperTitle,
          qids: basketQids,
          scores,
          includeAnswers: includeAnswersInWord,
          includeSolutions: includeSolutionsInWord,
        }),
      });

      if (!response.ok) {
        let errorMessage = "Word 导出失败";
        try {
          const data = await response.json();
          if (data.error) errorMessage = data.error;
        } catch {
          // 使用默认错误信息。
        }
        throw new Error(errorMessage);
      }

      const blob = await response.blob();
      const filename = getDownloadFilename(
        response.headers.get("Content-Disposition"),
        `${paperTitle || "数学试卷"}.docx`
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      window.alert(`Word 导出失败：${message}`);
    } finally {
      setExportingWord(false);
    }
  };

  const clearBasket = () => {
    if (basketQids.length === 0) {
      window.alert("试题篮已经是空的");
      return;
    }

    const confirmed = window.confirm(
      `确定清空试题篮中的 ${basketQids.length} 道题目吗？`
    );
    if (!confirmed) return;

    handleQuestionMouseLeave();
    setBasketQids([]);
    setScores({});
    previewCacheRef.current = {};
  };

  if (!loaded) {
    return (
      <div style={{ padding: "2rem", color: "var(--text)" }}>
        正在读取试题篮……
      </div>
    );
  }

  return (
    <main
      style={{
        maxWidth: "1200px",
        margin: "0 auto",
        padding: "2rem",
        color: "var(--text)",
      }}
    >
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>试题篮</h1>
          <p
            style={{
              marginTop: "0.5rem",
              marginBottom: 0,
              color: "var(--text-muted)",
            }}
          >
            共 {basketQuestions.length} 道题，总分 {totalScore} 分
          </p>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          <Link
            href="/"
            style={{
              padding: "0.65rem 1rem",
              border: "1px solid var(--border)",
              borderRadius: "7px",
              background: "var(--background)",
              color: "var(--text)",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            ← 返回题库
          </Link>

          <button
            type="button"
            onClick={clearBasket}
            disabled={basketQuestions.length === 0}
            style={{
              padding: "0.65rem 1rem",
              border: "1px solid #c62828",
              borderRadius: "7px",
              background: "transparent",
              color: "#c62828",
              font: "inherit",
              fontWeight: 600,
              cursor:
                basketQuestions.length === 0 ? "not-allowed" : "pointer",
              opacity: basketQuestions.length === 0 ? 0.5 : 1,
            }}
          >
            清空试题篮
          </button>
        </div>
      </header>

      <section
        style={{
          padding: "1.25rem",
          marginBottom: "1.5rem",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          background: "var(--surface)",
        }}
      >
        <label style={{ display: "block", fontWeight: 600 }}>
          试卷标题
          <input
            type="text"
            value={paperTitle}
            onChange={event => setPaperTitle(event.target.value)}
            placeholder="请输入试卷标题"
            style={{
              display: "block",
              width: "100%",
              boxSizing: "border-box",
              marginTop: "0.5rem",
              padding: "0.75rem",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              background: "var(--background)",
              color: "var(--text)",
              fontSize: "1rem",
            }}
          />
        </label>
      </section>

      <section
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "1rem",
          padding: "1rem 1.25rem",
          marginBottom: "1.5rem",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          background: "var(--surface)",
        }}
      >
        <strong style={{ color: "var(--text)" }}>Word 导出内容</strong>

        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
            color: "var(--text)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={includeAnswersInWord}
            onChange={event => setIncludeAnswersInWord(event.target.checked)}
          />
          包含答案
        </label>

        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
            color: "var(--text)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={includeSolutionsInWord}
            onChange={event => setIncludeSolutionsInWord(event.target.checked)}
          />
          包含解析
        </label>

        <button
          type="button"
          disabled={basketQuestions.length === 0 || exportingWord}
          onClick={exportWord}
          style={{
            marginLeft: "auto",
            padding: "0.7rem 1.1rem",
            border: "none",
            borderRadius: "7px",
            background: "#2563eb",
            color: "#ffffff",
            font: "inherit",
            fontWeight: 700,
            cursor:
              basketQuestions.length === 0 || exportingWord
                ? "not-allowed"
                : "pointer",
            opacity:
              basketQuestions.length === 0 || exportingWord ? 0.55 : 1,
          }}
        >
          {exportingWord ? "正在生成 Word……" : "导出为 Word"}
        </button>
      </section>

      {basketQuestions.length === 0 ? (
        <section
          style={{
            padding: "3rem 2rem",
            textAlign: "center",
            border: "1px dashed var(--border)",
            borderRadius: "8px",
            background: "var(--surface)",
          }}
        >
          <h2>试题篮为空</h2>
          <p style={{ color: "var(--text-muted)" }}>
            请返回题库，勾选需要组卷的题目。
          </p>
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0.85rem 1.1rem",
              borderRadius: "7px",
              background: "#1976d2",
              color: "#ffffff",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            前往题库选题
          </Link>
        </section>
      ) : (
        <div
          style={{
            overflowX: "auto",
            border: "1px solid var(--border)",
            borderRadius: "8px",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              background: "var(--background)",
            }}
          >
            <thead>
              <tr>
                <th style={headerCellStyle}>序号</th>
                <th style={headerCellStyle}>来源</th>
                <th style={headerCellStyle}>题号</th>
                <th style={headerCellStyle}>题型</th>
                <th style={headerCellStyle}>知识点</th>
                <th style={headerCellStyle}>难度</th>
                <th style={headerCellStyle}>分值</th>
                <th style={headerCellStyle}>排序</th>
                <th style={headerCellStyle}>操作</th>
              </tr>
            </thead>

            <tbody>
              {basketQuestions.map((question, index) => (
                <tr
                  key={question.qid}
                  onMouseEnter={event =>
                    handleQuestionMouseEnter(question, event)
                  }
                  onMouseMove={handleQuestionMouseMove}
                  onMouseLeave={handleQuestionMouseLeave}
                  style={{
                    background:
                      questionPreview?.qid === question.qid
                        ? "var(--surface)"
                        : undefined,
                    transition: "background-color 0.15s ease",
                  }}
                >
                  <td style={bodyCellStyle}>{index + 1}</td>
                  <td style={bodyCellStyle}>{question.source}</td>
                  <td style={bodyCellStyle}>{question.number}</td>
                  <td style={bodyCellStyle}>{question.type}</td>
                  <td style={bodyCellStyle}>
                    {question.knowledge.join("、")}
                  </td>
                  <td style={bodyCellStyle}>{question.difficulty}</td>
                  <td style={bodyCellStyle}>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={scores[question.qid] ?? 5}
                      onChange={event =>
                        updateScore(question.qid, event.target.value)
                      }
                      style={{
                        width: "70px",
                        boxSizing: "border-box",
                        padding: "0.4rem",
                        border: "1px solid var(--border)",
                        borderRadius: "4px",
                        background: "var(--background)",
                        color: "var(--text)",
                      }}
                    />
                  </td>
                  <td
                    style={bodyCellStyle}
                    onMouseEnter={handleQuestionMouseLeave}
                  >
                    <div style={{ display: "flex", gap: "0.35rem" }}>
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => moveQuestionToTop(index)}
                        title="置顶"
                        aria-label={`将第 ${index + 1} 道题置顶`}
                        style={orderButtonStyle}
                      >
                        ⇈
                      </button>
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => moveQuestion(index, -1)}
                        title="上移一位"
                        aria-label={`将第 ${index + 1} 道题上移一位`}
                        style={orderButtonStyle}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={index === basketQuestions.length - 1}
                        onClick={() => moveQuestion(index, 1)}
                        title="下移一位"
                        aria-label={`将第 ${index + 1} 道题下移一位`}
                        style={orderButtonStyle}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        disabled={index === basketQuestions.length - 1}
                        onClick={() => moveQuestionToBottom(index)}
                        title="置底"
                        aria-label={`将第 ${index + 1} 道题置底`}
                        style={orderButtonStyle}
                      >
                        ⇊
                      </button>
                    </div>
                  </td>
                  <td style={bodyCellStyle}>
                    <button
                      type="button"
                      onClick={() => removeQuestion(question.qid)}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: "#c62828",
                        font: "inherit",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      移除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>

            <tfoot>
              <tr>
                <td
                  colSpan={6}
                  style={{
                    ...bodyCellStyle,
                    textAlign: "right",
                    fontWeight: 700,
                  }}
                >
                  合计
                </td>
                <td style={{ ...bodyCellStyle, fontWeight: 700 }}>
                  {totalScore} 分
                </td>
                <td colSpan={2} style={bodyCellStyle} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {questionPreview && (
        <div
          style={{
            position: "fixed",
            left: Math.max(
              12,
              Math.min(questionPreview.x + 18, window.innerWidth - 440)
            ),
            top: Math.max(
              12,
              Math.min(questionPreview.y + 18, window.innerHeight - 230)
            ),
            zIndex: 2000,
            width: "min(400px, calc(100vw - 2rem))",
            maxHeight: "190px",
            boxSizing: "border-box",
            padding: "1rem",
            overflow: "hidden",
            border: "1px solid var(--accent)",
            borderRadius: "10px",
            backgroundColor: "#eef3ff",
            color: "#17213a",
            boxShadow: "0 16px 40px rgb(30 55 130 / 28%)",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              marginBottom: "0.5rem",
              color: "#3657bd",
              fontSize: "0.78rem",
              fontWeight: 700,
            }}
          >
            题干预览
          </div>
          <div
            style={{
              display: "-webkit-box",
              overflow: "hidden",
              fontSize: "0.9rem",
              lineHeight: 1.7,
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 5,
            }}
          >
            <MathText text={questionPreview.text} />
          </div>
        </div>
      )}

      {previewLoading && !questionPreview && (
        <div
          style={{
            position: "fixed",
            right: "1.5rem",
            bottom: "1.5rem",
            zIndex: 2000,
            padding: "0.65rem 0.9rem",
            border: "1px solid var(--border)",
            borderRadius: "7px",
            background: "var(--background)",
            color: "var(--text-muted)",
            boxShadow: "0 8px 24px rgb(0 0 0 / 14%)",
            fontSize: "0.8rem",
          }}
        >
          正在加载题干……
        </div>
      )}
    </main>
  );
}

const headerCellStyle = {
  padding: "0.85rem",
  borderBottom: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text-muted)",
  textAlign: "left" as const,
  whiteSpace: "nowrap" as const,
};

const bodyCellStyle = {
  padding: "0.85rem",
  borderBottom: "1px solid var(--border)",
  color: "var(--text)",
  verticalAlign: "middle" as const,
};

const orderButtonStyle = {
  minWidth: "32px",
  minHeight: "30px",
  border: "1px solid var(--border)",
  borderRadius: "5px",
  background: "var(--background)",
  color: "var(--text)",
  cursor: "pointer",
};
