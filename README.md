# terminology

程序员沟通术语库 —— 按领域分类的 CSV 数据集 + 静态展示网站。

**在线访问**: https://darrenhp.github.io/terminology/

## 领域划分（27 个领域 / 1766 条术语，其中 35 条带「避坑要点」）

| 分组 | 领域 | 文件 | 条数 |
| --- | --- | --- | --- |
| 研发协作 | 研发协作沟通 | `data/collaboration.csv` | 86 |
| 研发协作 | 项目管理 | `data/project-mgmt.csv` | 22 |
| 研发协作 | 产品与设计 | `data/product-design.csv` | 60 |
| 研发协作 | Git 与版本管理 | `data/git.csv` | 24 |
| 研发协作 | 测试与质量 | `data/testing.csv` | 20 |
| 前端领域 | Web 前端 | `data/frontend-web.csv` | 56 |
| 前端领域 | 移动端 | `data/frontend-mobile.csv` | 51 |
| 前端领域 | PC / Mac 客户端 | `data/frontend-desktop.csv` | 39 |
| 前端领域 | 交互组件 | `data/ui-components.csv` | 109 |
| 前端领域 | 自适配与布局 | `data/adaptive-layout.csv` | 40 |
| 后端与基础设施 | 后端与服务 | `data/backend.csv` | 131 |
| 后端与基础设施 | 一致性与分布式 | `data/consistency.csv` | 50 |
| 后端与基础设施 | 部署与 DevOps | `data/deployment.csv` | 84 |
| 后端与基础设施 | 数据库 | `data/database.csv` | 58 |
| 后端与基础设施 | 安全 | `data/security.csv` | 72 |
| 计算机科学基础 | 系统与网络基础 | `data/network.csv` | 123 |
| 计算机科学基础 | 算法数学与编程 | `data/algo-math.csv` | 74 |
| 智能与数据 | AI 与大模型 | `data/ai-llm.csv` | 79 |
| 智能与数据 | 数据工程 | `data/data-eng.csv` | 18 |
| 企业应用 | ERP 与企业应用 | `data/erp.csv` | 91 |
| 企业应用 | WFM 与劳动力管理 | `data/wfm.csv` | 25 |
| 图表与可视化 | 图表与可视化 | `data/charts-viz.csv` | 76 |
| 运营与增长 | 用户运营 | `data/user-ops.csv` | 116 |
| 运营与增长 | 广告与变现 | `data/ads.csv` | 160 |
| 金融与经济 | 投资与交易 | `data/investing.csv` | 65 |
| 金融与经济 | 经济与金融 | `data/macro-econ.csv` | 34 |
| 其他 | 暂无归类 | `data/misc.csv` | 3 |

## 数据格式

每个领域一个 CSV 文件，UTF-8 编码，表头固定为 7 列（第 7 列可选）：

```csv
term,en,category,definition,scenario,related,pitfall
```

| 列 | 含义 | 示例 |
| --- | --- | --- |
| `term` | 中文术语 | 吐司提示 |
| `en` | 英文名称 | Toast |
| `category` | 子分类 | 反馈组件 |
| `definition` | 一句话释义 | 闪现后自动消失的轻量消息 |
| `scenario` | 使用场景（沟通示例） | 保存成功弹个 Toast |
| `related` | 相关术语（分隔符: `,` `、` `;` `/`） | Tip,浮层 |
| `pitfall` | **可选**，落地时最容易踩的坑 | 关闭后定时任务没清理，内存泄漏 |

`pitfall` 是后来加的可选列，存量术语留空即可：构建脚本会把 6 元组自动补齐到 7 列，
前端只在「当前结果里至少有一条带坑」时才显示该列，其余时候整列隐藏。

`data/domains.json` 是领域索引（名称 / 分组 / 描述 / 文件名 / 条数），网站启动时加载。

## 网站工作原理

纯静态站点，无构建依赖、无外部 CDN：

1. 加载 `data/domains.json` 渲染左侧领域导航
2. 点击领域时**下载对应的 CSV 文件**，浏览器端解析（自带 CSV 解析器，支持引号转义）
3. 支持全领域搜索、分类筛选、相关术语跳转、点击复制、`#domain-id` 分享链接

## 添加 / 修改术语

编辑 `scripts/` 下的数据脚本后重新生成：

```bash
python3 scripts/build_data.py
```

脚本会做校验（前 6 列空字段、领域内重复术语、`PITFALLS` 补坑未命中），
通过后覆盖生成 `data/*.csv` 与 `data/domains.json`。

- `scripts/data_collab.py` —— 协作沟通、产品与设计
- `scripts/data_pm.py` —— 项目管理
- `scripts/data_growth.py` —— 用户运营、广告与变现
- `scripts/data_finance.py` —— 投资与交易、经济与金融
- `scripts/data_git.py` —— Git 与版本管理、测试与质量
- `scripts/data_frontend.py` —— 前端 5 个领域
- `scripts/data_backend.py` —— 后端与基础设施 6 个领域
- `scripts/data_ai.py` —— AI 与大模型、数据工程
- `scripts/data_erp.py` —— ERP 与企业应用
- `scripts/data_wfm.py` —— WFM 与劳动力管理
- `scripts/data_charts.py` —— 图表与可视化
- `scripts/data_zhihu.py` —— 知乎「概念祛魅」语料：新建 `algo-math`（算法数学与编程）与 `misc`（暂无归类），并通过 `MERGE_TERMS` / `DOMAIN_PATCH` 把其余条目并入已有领域（network 改名「系统与网络基础」并扩到 123 条、ai-llm、collaboration、user-ops、data-eng、testing、product-design、deployment、backend）
- `scripts/data_pitfall.py` —— 后端「避坑」补充：给已有术语补 `pitfall`，并新增 14 条自带坑位的术语（软删除、审计字段、时态表、部分索引、幂等键、退避重试、死信队列、多租户、契约版本、优雅停机、金丝雀、特性开关、事务边界、最终一致）

## 避坑数据的两种写法

`scripts/data_pitfall.py` 里两个结构，按需选用：

```python
# 1) 术语已存在：只补坑，不新增条目（避免同领域重复）
PITFALLS = {("backend", "分布式锁"): "无 fencing token 时，锁过期后的旧请求会写脏数据"}

# 2) 术语不存在：整条新增，第 7 列写坑
NEW_TERMS = {"database": [
    ("软删除", "Soft Delete", "数据建模", "用标记列代替物理删除…", "用户注销走软删除…", "审计字段、时态表", "所有查询都要带删除标记条件…"),
]}
```

## 本地预览

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

## 部署

推送到 `main` 分支即通过 GitHub Pages 发布（仓库设置 → Pages → Source: `main` / root）。
