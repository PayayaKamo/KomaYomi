---
layout: home
titleTemplate: false
description: KomaYomi（Koma＝漫画分格，Yomi＝读，中文也称“格读”）文档——本地优先的漫画分格精读工具，支持日/中/英对照阅读、分格检测、对齐与批注。
title: KomaYomi（格读）— 本地优先的漫画分格精读工具

hero:
  name: KomaYomi
  text: 漫画分格精读
  tagline: 日本語はすべて漫画から学んだ~
  image:
    src: /assets/screenshots/hero-real-library.png
    alt: 真实图库的三语对照阅读界面，漫画画面已模糊处理
  actions:
    - theme: brand
      text: 快速上手
      link: /zh/guide/introduction
    - theme: alt
      text: 数据格式
      link: /zh/data-format

features:
  - title: 分格优先
    details: 自动 XY-cut 检测，并支持手动绘制、合并、编号和可复用的布局模板。重新检测或套用模板时，笔记与标注会跟随画面重新映射，不再因为重排而丢失。
  - title: 多语言对照
    details: 并排或叠加视图，按语言独立遮罩，滚轮缩放与平移，以及页面 / 分格 / 锚点 / 网格四种对齐方式，可保存为预设。
  - title: 笔记随身走
    details: 页面级或分格级的 Markdown 笔记、标签、来源、速记板、全文搜索，以及一键“复制上下文”粘贴到 LLM。
  - title: 可移植的输出
    details: 导出带图片文件夹的 HTML 或单文件内嵌 HTML，渲染页面 / 分格 / 拼图 PNG，并用 `.mnproj` 项目迁移全部内容。
---

## 什么是 KomaYomi？

KomaYomi（**格读**：Koma＝漫画分格，Yomi＝读）是一个用漫画学语言、做笔记的**本地 Web 应用**：同一部漫画的日文、中文和英文版本并排对照，边读边记。它的基本单位是“格”而不是“页”：先把画面解构成分格，再对齐不同版本，最后把笔记锚定到具体画面上。你的页面图片保留在 `raw/` 文件夹中；每个分格、笔记、标签、对齐偏移和标注都存放在 `data/` 下的纯 JSON 里。除非你主动导出，否则任何内容都不会离开本机。

它的定位是学习与翻译校对，而不是托管受版权保护的内容：自备扫描件，把应用指向该文件夹，然后逐页处理。

## 状态一览

KomaYomi 目前处于 **1.0.1 版本**。本文档会区分已经实现的功能和计划中的功能。

<div class="status-list">
  <div><strong>当前可用</strong> —— 图库扫描（含多作品根目录）、XY-cut 分格检测、手动编辑分格、拆分格子与带 1–10 快捷位置、右键移动的手工重排编号、分格分组与页面历史、侧栏页面列表的三种显示方式（双列缩略图、单列缩略图、带语言与笔记数的列表）、分格/布局模板、带锚点引线的矢量标注、带遮罩和四种对齐模式的对照阅读、按语言整页并排且支持联动 / 独立缩放拖动的原版阅读视图、分格详情视图与按分格 ID 的深链（双击对照阅读的整行，包括空白边距，即可打开）、详情页中仅当前会话生效的按语言对齐、跨页跨话的上一格 / 下一格、专注模式、编辑 / 阅读（只读）模式、可搜索的 Markdown 笔记与单编辑器编辑、页面或分格级的类型化笔记（背景知识、生词、吐槽，每种启用语言一个类型，自定义类型存于 `data/library.json`，支持筛选、分组与按类型新建）、带六个首次使用步骤和新入口的起始页、HTML / PNG / PDF（打印）/ 默认烘焙标注的 Word 导出、备份 ZIP 与定时自动备份、缓存管理、上传到 WebDAV/网络目标、带按需 LRU 缓存和离线写入队列的 WebDAV/网络图片源、带 schema 校验的原子页面保存与 `.bak` 轮转和并发写锁、`.mnproj` 项目导出/导入、CLI 批处理工具。</div>
  <div><strong>计划中</strong> —— 词表导出；应用内的图片格式转换（重命名与拆分已在预处理中）；完整形态的原生移动端应用（响应式 Web 界面在窄窗口下可用）；更广泛的集成测试。</div>
</div>

本站中标记为 <Badge type="warning" text="计划中" /> 的任何内容都**尚未实现**。如果某个页面描述了代码中并不存在的行为，请以本条说明为准，并视该功能为不可用。

## KomaYomi 的四个仓库

本站记录的是桌面端完整版。同一个项目还有另外三种形态：

- [KomaYomi](https://github.com/PayayaKamo/KomaYomi) —— 桌面端完整版（Electron 加本地服务），也就是本站介绍的对象。
- [KomaYomi-online](https://github.com/PayayaKamo/KomaYomi-online) —— 纯浏览器版，打开 `.mnproj` 工程即可阅读、标注与导出，不需要服务端。
- [KomaYomi-mobile](https://github.com/PayayaKamo/KomaYomi-mobile) —— React Native 的 Android / iOS 应用；鸿蒙 NEXT 目前只有占位。
- [KomaYomi-docs](https://github.com/PayayaKamo/KomaYomi-docs) —— 本站的构建产物，由 CI 推送；要改文档请回主仓库。

各形态共用同一套页面 JSON 与 `.mnproj` 格式，工作内容可以在它们之间迁移。

## 接下来去哪里

- 初次使用？请先阅读[简介](/zh/guide/introduction)，再看[安装与运行](/zh/guide/installation)。
- 想了解整体思路？从[核心概念](/zh/concepts)开始。
- 要基于 JSON 写脚本或开发插件？请前往[数据格式](/zh/data-format)和[布局模板与插件](/zh/extending)。
- 卡在缺失的页面或损坏的导出上？请查看[常见问题与故障排查](/zh/faq)。

::: tip 文档语言
英文是主要语言。中文译文位于 `/zh/`，日文译文位于 `/ja/`。每个页面会分别说明自身的状态。
:::
