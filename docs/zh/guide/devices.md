# 不同设备上的样子

同一个应用，几种身形。KomaYomi 靠重排来适应屏幕，而不是另做一套手机版把功能藏起来——按钮该在的都在，只是会换个位置。这一页说明主界面在各尺寸下怎么排，每种尺寸都配了真实截图。

## PC 横屏 — 1440 px

<figure class="shot">
  <img src="/assets/screenshots/device-pc-landscape.png" alt="1440 px 宽的窗口：左侧图库侧栏、中间三栏对照、右侧笔记栏">
  <figcaption>1440 px：左边侧栏，中间三语并排，右边笔记栏。</figcaption>
</figure>

1440 px 时侧栏（约 240 px）、对照舞台和笔记栏能同时显示。三语并排铺开，一段对话不用滚动就能看全；窗口宽于 1180 px 时笔记栏默认展开——拖动分隔条可以加宽，按 **笔记**（`N`）可以收起。

## PC 竖屏 — 900 × 1200

<figure class="shot">
  <img src="/assets/screenshots/device-pc-portrait.png" alt="900 × 1200 的窄窗口：图库收成抽屉，对照栏纵向堆叠">
  <figcaption>900 × 1200：侧栏收进抽屉，对照只剩一栏，笔记栏默认收起。</figcaption>
</figure>

到 900 px 就进入窄屏模式：图库收进 ☰ 按钮后面的抽屉，对照视图变成单栏纵向堆叠，笔记栏默认关闭——按 **笔记** 再叫出来。工具栏分组会去掉文字标签，放不下的操作挪进 **More**。

## 手机竖屏 — 390 × 844

<figure class="shot">
  <img src="/assets/screenshots/device-phone-portrait.png" alt="390 × 844 的手机窗口：对照区只有一栏，语言标签与折成多行的工具栏">
  <figcaption>390 × 844：对照只有一栏；用「语言」标签切换 JA / EN / ZH；工具栏折成多行。</figcaption>
</figure>

390 px 的手机上，顶栏折成三行：先是导航和翻页，再是界面语言与导出，最后是 **Panels / Compare** 视图切换。对照区保持单栏，同一条格子的各语言纵向排列；**语言**标签（JA / EN / ZH）决定显示哪几种语言，因为宽度不够并排两栏。工具栏分组会折到下一行，而不是横向滚走；图库和笔记都以整屏抽屉打开。

## 平板竖屏 — 820 × 1180

<figure class="shot">
  <img src="/assets/screenshots/device-tablet-portrait.png" alt="820 × 1180 的平板窗口：顶栏保持一行，对照仍是占满宽度的单栏">
  <figcaption>820 × 1180：顶栏一行，侧栏收在抽屉里，对照仍是一栏，工具栏收成两排。</figcaption>
</figure>

820 px 时顶栏回到单行，侧栏仍是抽屉，但对照区依旧只有一栏——各语言上下堆叠，而不是并排。**语言**标签的用法和手机相同；工具栏收成两排：先语言与视图控制，再标注工具。笔记以抽屉形式盖在对照区上打开。

## 平板横屏 — 1180 × 820

<figure class="shot">
  <img src="/assets/screenshots/device-tablet-landscape.png" alt="1180 × 820 的平板窗口：侧栏展开，三语并排">
  <figcaption>1180 × 820：侧栏展开，三语并排，笔记仍是抽屉。</figcaption>
</figure>

1180 px 时侧栏（240 px）重新出现，三语并排，每栏约 290 px。这个宽度下笔记仍是抽屉，打开后盖在对照区上；工具栏保持两排——语言与对齐控制在上一排，标注工具在下一排，**Export HTML** 留在顶栏。

::: tip 自己想截图的话
请直接调整浏览器窗口大小，不要用页面缩放：断点跟的是视口宽度，侧栏和笔记栏只有窗口本身越过断点才会换位置。
:::
