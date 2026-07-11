import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../src/features/docs/index.tsx', import.meta.url),
  'utf8'
)

test('Codex guides combine install and upgrade with a visible release note', () => {
  expect(source).toContain('第三步：快速安装与升级')
  expect(source).toContain('当前版本更新于：2026年7月11日')
  expect(source).toContain('支持 ChatGPT 5.6 全系列')
  expect(source).toContain('修复部分兼容问题。')
  expect(source).not.toContain('解决部分计价')
  expect(source).toContain(
    '粘贴运行命令（版本更新后再次执行命令即可升级）'
  )
})

test('one-line setup warns that conflicting API connections are replaced', () => {
  expect(source).toContain('运行前请注意')
  expect(source).toContain('自动覆盖当前接口和')
  expect(source).toContain('清理会导致调用串线的同类旧环境变量/旧配置')
  expect(source).toContain('此前接入的其他')
  expect(source).toMatch(/API\s+将退出/)
  expect(source).toMatch(/不会删除系统代理、AWS\s+凭据或其他工具配置/)
})
