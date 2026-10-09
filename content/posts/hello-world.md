---
title: "你好，世界"
date: 2026-10-09
draft: false
tags: ["随笔"]
categories: ["生活"]
summary: "这是站点部署完成后的一篇示例文章，用来验证构建与发布链路，可随时删除。"
---

这是 `fengzhao-blog` 的第一篇文章。

如果你能在 https://blog.fengzhao.pro 上看到它，说明下面这条链路已经完全打通：

```
本地写作 → git push → GitHub Actions 构建 Hugo → 推送到 gh-pages 分支 → GitHub Pages 托管
```

## 示例代码块

```python
def hello(name: str) -> str:
    return f"Hello, {name}!"

print(hello("fengzhao"))
```

## 下一步

1. 在 `content/posts/` 下用 `hugo new content posts/文章名.md` 新建文章
2. 写完把 `draft` 改成 `false`
3. `git push` 即可自动发布
