# MathAtlas

MathAtlas 是一个基于 **Next.js + 本地 Markdown 题库** 的数学试题管理（核心）与组卷工具（轻度）。

程序以本地文件夹作为题库数据源，支持题目录入、筛选浏览、试题篮组卷、题目排序、安全删除，以及 Markdown、LaTeX 和 Word 等格式的导出。

---

## 主要功能

### 1. 本地 Markdown 题库

- 题目以 Markdown 文件形式保存在本地题库目录中。
- 使用 YAML Frontmatter 保存题目元数据。
- 支持 16 位数字 `qid`，用于唯一标识每一道题。
- 题库文件可直接使用编辑器查看和修改。
- 无需部署数据库，便于备份、迁移和版本管理。

默认题库目录：

```text
demo-vault/题库
```

默认图片目录：

```text
demo-vault/images
```

---

### 2. 题目录入

- 支持一次录入一道或多道题目。
- 多道题之间使用以下分隔符分隔：

```text
==========
```

- 自动解析以下题目结构：
  - 题目
  - 选项
  - 答案
  - 解析
  - 我的备注
  - AI 备注
- 支持从 YAML 中读取来源、题号、题型、年级、学期、类别、难度、知识点和标签。
- 支持设置默认年级、学期、类别和题型。
- 支持图片上传和剪贴板图片粘贴。
- 支持录入前预览。
- 支持点击预览卡片定位到左侧原文。
- 支持文件冲突检查。
- 文件冲突时可选择：
  - 跳过已有题目
  - 覆盖已有题目
- 新题自动生成 16 位唯一 `qid`。
- 添加成功后自动返回题库，并立即显示新题，无需重启程序。

---

### 3. 题库筛选与浏览

题库首页支持以下筛选条件：

- 年级
- 类别
- 来源
- 题型
- 题号范围
- 难度范围
- 知识点
- 标签
- 手动输入 `qid`

支持以下排序方式：

- 来源
- 题号
- 难度
- 题型
- 升序或降序

支持两种查看模式：

- **表格模式**：快速查看题目元数据和执行批量操作。
- **浏览模式**：查看较完整的题目内容。

表格模式中可展开单道题目，查看：

- 题干
- 选项
- 答案
- 解析
- 我的备注
- AI 备注

---

### 4. 试题篮

题目可加入试题篮，用于组卷和导出。

试题篮支持：

- 持久化保存已选题目。
- 调整每道题的分值。
- 自动计算总分。
- 编辑试卷标题。
- 从试题篮移除题目。
- 清空试题篮。
- 鼠标停留在题目行上后显示部分题干预览。
- 调整题目顺序并自动保存。

排序按钮：

```text
⇈  置顶
↑  上移一位
↓  下移一位
⇊  置底
```

题目顺序会同步应用到 Word 等导出结果。

---

### 5. Word 导出

试题篮支持导出为 `.docx` 文件。

导出内容包括：

- 试卷标题
- 学生信息填写区域
- 题目数量和总分
- 题干
- 选项
- 每题分值
- 可选答案
- 可选解析

Word 导出依赖 Pandoc。

检查 Pandoc 是否安装：

```powershell
pandoc --version
```

Windows 可通过 winget 安装：

```powershell
winget install --source winget --exact --id JohnMacFarlane.Pandoc
```

如果 Pandoc 未加入系统 PATH，可在项目根目录的 `.env.local` 中配置：

```env
PANDOC_PATH=C:\你的路径\pandoc.exe
```

修改 `.env.local` 后需要重新启动开发服务器。

---

### 6. Markdown 与 LaTeX 导出

题库首页支持将当前筛选结果或试题篮内容导出为：

- 复制为 Markdown
- 下载 Markdown 压缩包
- 复制为 LaTeX
- 下载 LaTeX 压缩包
- 导出 LaTeX 到本地目录

压缩包可同时包含题目引用的图片。

---

### 7. 安全删除与回收站

表格模式支持删除题目。

删除题目时：

1. 显示确认提示。
2. 将题目 Markdown 文件移出题库。
3. 文件不会立即永久删除。
4. 文件会移动到本地回收站目录。
5. 题目会立即从表格和试题篮中消失。
6. 图片不会自动删除，避免影响其他引用同一图片的题目。

默认回收站目录：

```text
demo-vault/.math-atlas-trash
```

如需恢复题目，可将对应 Markdown 文件移回：

```text
demo-vault/题库/对应来源目录
```

恢复后点击“刷新题库”即可重新显示。

---

### 8. 题库缓存与即时同步

为避免每次请求都重新读取大量 Markdown 文件，MathAtlas 使用内存缓存保存题目元数据。

同时使用版本文件进行跨模块缓存同步：

```text
demo-vault/.math-atlas-version
```

新增、覆盖、删除或手动刷新题库时，程序会：

```text
修改 Markdown 文件
→ 清除当前模块缓存
→ 原子更新版本文件
→ 使首页路径缓存失效
→ 重新扫描题库
→ 页面立即显示最新结果
```

版本文件通过临时文件和原子替换方式更新，避免读取到空内容或不完整版本号。

题库首页提供“刷新题库”按钮，可手动清除缓存并重新读取磁盘中的 Markdown 文件。

---

## 题目文件格式

示例：

```markdown
---
qid: 1785932101773000
grade: 高中
source: 25全国1
number: T19
type: 解答题
difficulty: 0.15
semester: 高三下
exam_type: 高考真题
knowledge:
  - 导数求函数的最值（不含参）
  - 解余弦不等式
tags:
  - 导数
status: 待入库
selected: false
---

## 题目

已知函数……

## 选项

A. ……

B. ……

## 答案

……

## 解析

……

## 备注

### 我的备注

……

### AI 备注

……
```

并非所有栏目都必须存在，具体内容可根据题型调整。

---

## 项目目录说明

```text
src/
├── app/
│   ├── page.tsx
│   ├── add/
│   │   └── page.tsx
│   ├── examBasket/
│   │   └── page.tsx
│   └── api/
│       ├── add-questions/
│       │   └── route.ts
│       ├── export-word/
│       │   └── route.ts
│       ├── export-latex/
│       │   └── route.ts
│       ├── images/
│       └── questions/
│           ├── [qid]/
│           │   └── route.ts
│           └── refresh/
│               └── route.ts
├── components/
│   ├── FilterableTable.tsx
│   ├── FilterableTable.module.css
│   ├── BrowseView.tsx
│   ├── ExamBasketView.tsx
│   ├── MathText.tsx
│   └── ThemeToggle.tsx
└── lib/
    ├── questions.ts
    └── latex.ts

demo-vault/
├── 题库/
├── images/
├── .math-atlas-trash/
└── .math-atlas-version
```

实际目录可能因项目后续调整而有所不同。

---

## 环境要求

建议环境：

- Node.js
- npm
- Next.js
- 现代浏览器
- Pandoc（仅 Word 导出需要）

---

## 安装依赖

在项目根目录执行：

```powershell
npm install
```

如果项目已经有完整的 `package-lock.json`，也可以执行：

```powershell
npm ci
```

---

## 配置题库路径

默认使用：

```text
./demo-vault
```

如需使用其他题库目录，可在项目根目录创建：

```text
.env.local
```

配置：

```env
VAULT_PATH=D:\你的题库目录
```

Windows 路径请根据实际位置修改。

修改环境变量后需要重新启动开发服务器。

---

## 启动开发服务器

```powershell
npm run dev
```
或者
```
npm run dev:clean
```
然后在浏览器访问：

```text
http://localhost:3000
```

如果 Turbopack 在本地环境出现异常，可使用 Webpack：

```powershell
npm run dev -- --webpack
```

也可以在 `package.json` 中将开发命令设为：

```json
{
  "scripts": {
    "dev": "next dev --webpack"
  }
}
```

---

## 常用操作流程

### 录入并组卷

```text
添加题目
→ 预览并确认入库
→ 回到题库筛选题目
→ 加入试题篮
→ 调整顺序和分值
→ 设置试卷标题
→ 导出 Word
```

### 删除测试题

```text
题库表格
→ 点击“删除”
→ 确认删除
→ Markdown 移入回收站
→ 表格立即更新
```

### 手动刷新题库

```text
外部修改 Markdown
→ 返回题库首页
→ 点击“刷新题库”
→ 重新扫描本地题库
```

---

## 数据安全建议

- 定期备份 `demo-vault`。
- 不要随意删除 `.math-atlas-trash` 中的文件。
- 不要手动创建重复的 `qid`。
- 修改 YAML 时注意缩进和数组格式。
- 正式删除前建议先使用测试题验证流程。
- 大批量覆盖题目前建议先备份题库。
- 不要把包含私人内容的本地题库提交到公开仓库。

---

## 当前功能状态

已实现：

- 本地 Markdown 题库
- 16 位唯一 qid
- 批量题目录入
- 图片上传与粘贴
- 录入预览
- 文件冲突处理
- 多条件筛选
- 表格与浏览模式
- 题目详情展开
- 试题篮持久化
- 分值和总分管理
- 题干悬浮预览
- 置顶、上移、下移、置底
- Word 导出
- Markdown 导出
- LaTeX 导出
- 安全删除与本地回收站
- 手动刷新题库
- 跨模块缓存失效
- 版本文件原子更新

可继续扩展：

- 可视化回收站管理页面
- 一键恢复已删除题目
- 批量永久删除
- 题目编辑页面
- 重复题检测
- 试卷模板管理
- 导出样式模板
- 题目统计与知识点分析
- 用户权限和多人协作

---

## License

请根据项目实际使用方式补充许可证信息。
