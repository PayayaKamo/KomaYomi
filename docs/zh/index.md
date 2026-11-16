---
layout: home
titleTemplate: false
description: KomaYomi（格读）文档——本地优先、以格为单位的漫画精读工具。日/中/英三语对照，把笔记与批注钉在画面上，导出干净的学习页；文件都留在你自己的电脑里。
title: KomaYomi（格读）— 本地优先的漫画精读工具

hero:
  name: KomaYomi（格读）
  text: 把漫画拆成一格一格来精读
  tagline: 同一页看日/中/英三语，笔记与批注钉在画面上。本地优先，不注册账号。
  image:
    src: /assets/screenshots/hero-real-library.webp
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
  - title: 笔记跟着画面走
    details: 页面级或分格级 Markdown 笔记，按类型显示为带配色的卡片，可钉在画面某一点；标签、来源、速记板、全文搜索，以及一键“复制上下文”粘贴到 LLM。
  - title: 可移植的输出
    details: 导出带图片文件夹的 HTML 或单文件内嵌 HTML，渲染页面 / 分格 / 拼图 PNG 与分享图，并用 `.mnproj` 项目迁移全部内容。
---

## 为什么做 KomaYomi

用漫画学外语，通常要开三个窗口：原版、译本、词典，再另开一个笔记软件；看到想记的那一句，位置还常常对不上。KomaYomi（格读）把同一页的日文、中文、英文放进同一个窗口，先切成格，再让你把 Markdown 笔记和批注钉在具体画面上。工作单位是「格」，不是「页」。

它是个本地 Web 应用：页面图片留在 `raw/` 文件夹，分格、笔记、标签和标注都在 `data/` 下的纯 JSON 里。除非你主动导出，否则任何内容都不会离开本机。请自备扫描件——它是学习工具，不是漫画托管服务。

作者主页：[X · @payayakamo](https://x.com/payayakamo) · [note · @payayakamo](https://note.com/payayakamo)。这两个是作者个人主页，不是产品官网。

## 三步跑起来

1. **装好或直接跑**：在 [GitHub Releases](https://github.com/PayayaKamo/KomaYomi/releases) 下载安装包；或 `npm install && npm run dev`，打开 `http://127.0.0.1:5173`。
2. **指定页面**：把图片放成 `raw/<卷>/<语言>/<话>/001.jpg`，也可以用「文件 → 打开图库文件夹…」。
3. **打开一话**：首次打开会自动分格（先当草稿），然后到对照阅读里读、写笔记、导出。

完整的安装方式、首次目录结构与分格修正见[安装与运行](/zh/guide/installation)和[简介](/zh/guide/introduction)。

## 状态一览

KomaYomi（格读）目前处于 **1.2.0 版本**。本文档会区分已经实现的功能和计划中的功能。

<div class="status-list">
  <div><strong>阅读</strong> —— 图库扫描（含多作品根目录）、侧栏三种页面列表、分格检测与手动编辑、拆分与重排编号、布局模板、带按语言遮罩的对照阅读、原版阅读视图、1:1 放大看图、跨页跨话的上一格 / 下一格并自动居中、专注模式与只读模式。</div>
  <div><strong>笔记与标注</strong> —— 页面级或分格级 Markdown 笔记；类型化笔记（背景知识、生词、吐槽，每种启用语言一个类型，另可自建分类与配色）；钉在画面上的笔记与合并气泡、笔记搜索、单编辑器；带锚点引线、按语言隔离、支持右键菜单的矢量标注；与撤销栈打通的操作历史。</div>
  <div><strong>工程与输出</strong> —— `.mnproj` 保存写回已打开的文件；桌面端「另存为…」生成副本（浏览器里回退为下载）；HTML / PNG / PDF（打印）/ Word 导出，默认烘焙标注；小红书分享图；备份 ZIP 与定时备份；缓存管理；带离线写入队列的 WebDAV 源；带 schema 校验的原子写入、`.bak` 轮转与并发写锁；CLI 批处理工具。</div>
  <div><strong>内置演示</strong> —— 桌面安装包内附带一份演示工程（约占安装包 65 MB）；在欢迎页一键打开即可浏览真实的日中英三语卷，退出演示会删除它添加的页面并还原你原来的状态。</div>
  <div><strong>计划中</strong> —— 词表导出；应用内的图片格式转换（重命名与拆分已在预处理中）；更广泛的集成测试。</div>
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
