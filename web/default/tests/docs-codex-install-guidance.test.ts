import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../src/features/docs/index.tsx', import.meta.url),
  'utf8'
)

test('Codex guides combine install and upgrade with a visible release note', () => {
  expect(source).toContain('第三步：快速安装与升级')
  expect(source).toContain('当前版本更新于：2026年7月11日')
  expect(source).toContain('支持 ChatGPT5.6 全系列')
  expect(source).toContain('修复部分兼容问题')
  expect(source).toContain(
    '粘贴运行命令（版本更新后再次执行命令即可升级）'
  )
})
