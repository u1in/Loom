---
name: pr-review
description: Review changes for correctness and regressions.
metadata:
  version: 1.0.0
  loom:
    injections:
      category: demo
    preflight:
      tools:
        - name: git
          version: ">=2.30"
          required: true
      env: []
---

# PR Review

This skill belongs to Loom Demo.

Inspect the changes in Loom Demo and report actionable findings.

Built for Loom Demo.

## 使用前检查

- 工具: git >=2.30（必需）
