# AGPL-3.0 合规说明（务必遵守）

本仓库基于开源项目 **new-api** 二次开发，复用了其大量代码，因此**整体属于 AGPL-3.0 衍生作品**。
许可证义务跟着「代码」走，与 GitHub 是否标记为 fork 无关。

- 上游项目：<https://github.com/QuantumNous/new-api>（原 Calcium-Ion/new-api）
- 上游的上游：[One API](https://github.com/songquanpeng/one-api)（MIT）
- 本项目运营主体：Bymii AI Global Limited（香港）
- 许可证全文：见 [`LICENSE`](./LICENSE)（GNU AGPLv3）

## 🔴 重设计期间不可触碰的合规红线

无论前端怎么重构换肤，以下三点必须保留，否则即为侵权：

1. **保留 `LICENSE` 文件，且不得改成更宽松或闭源协议。** 本项目及全部修改必须以 AGPL-3.0 发布。
2. **保留作者署名文案**：`Frontend design and development by New API contributors.`
   —— 既要在法律声明里保留，也要在 UI 的「关于 / 页脚 / 法律」等显著位置保留。
3. **保留 UI 中指向原项目的可见链接**：`https://github.com/QuantumNous/new-api`。

> 上述署名 + 链接当前位于：
> `web/default/src/components/layout/components/footer.tsx` 中的 `ProjectAttribution` 组件
> （`NEW_API_FOOTER_ATTRIBUTION_KEY` 常量 + `<a href="https://github.com/QuantumNous/new-api">`）。
> 重设计页脚时，样式随便改，但这段署名和链接必须留下来。
> 这是 AGPLv3 **Section 7** 附加条款的强制要求。

## 🔴 何时必须开源（AGPL §13 网络条款）

AGPL 比普通 GPL 多一条「网络条款」：**只要把修改版部署成网络服务、让用户通过网络访问，
就必须向这些用户提供完整对应源码**——即使从未分发过任何文件。

- ✅ 开发期间：本仓库可一直保持 **private**，想开发多久都行。
- ⛔ 一旦把重设计版**上线给用户使用**：义务当场触发，必须同时能提供对应源码。
  实操就是 **上线时把本仓库转为 public**（或在服务内放置可下载的对应源码）。
- 「先私下开发、上线后开源」这条路成立的前提就是：**上线即开源，不能拖**。

## 想保留闭源/商业价值的合规出路

- **买商业授权**：联系上游 <support@quantumnous.com> 获取商业许可证，可豁免 AGPL 义务。
- **架构隔离**：把私有增值逻辑做成独立服务，与 new-api 通过网络/API 保持距离地通信，
  而非直接改其源码（法律灰区，边界需谨慎）。

## 上游同步

```bash
git fetch upstream
git merge upstream/main      # 或 rebase，定期拉取 new-api 安全/功能更新
```
