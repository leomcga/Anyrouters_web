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
  expect(source).toContain('粘贴运行命令')
  expect(source).toContain('（版本更新后再次执行命令即可升级）')
  expect(source).toContain("<strong className='font-semibold'>")
})

test('one-line setup explains its scope below the command', () => {
  expect(source).toContain('运行前请注意')
  expect(source).toMatch(/这条命令只会更新 \{toolName\} 的 API\s+接口、密钥和相关环境配置/)
  expect(source).toMatch(/不会影响系统代理、AWS\s+凭据或其他工具配置/)
  expect(source).toContain('如果希望自己确认每一步')
  expect(source).toContain('可以使用下方「开发者」里的手动配置')
  expect(source).toContain(
    '<CodeBlock code={command} />\n              <ApiTakeoverNotice tool={tool} />'
  )
  expect(source).not.toContain('清理会导致调用串线的同类旧环境变量/旧配置')
})
