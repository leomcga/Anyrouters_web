import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../src/features/docs/index.tsx', import.meta.url),
  'utf8'
)

test('Codex guides combine install and upgrade with a visible release note', () => {
  expect(source).toContain('第三步：快速安装与升级')
  expect(source).toContain('当前版本更新于：2026年7月12日')
  expect(source).toContain('支持 ChatGPT 5.6 全系列')
  expect(source).toContain('自动修复 Codex 连接 Azure 时的 GPT-5.6 兼容问题')
  const notice = source.slice(
    source.indexOf('function CodexUpdateNotice()'),
    source.indexOf('function ApiTakeoverNotice')
  )
  expect(notice).not.toContain('原生多代理协作')
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

test('success previews keep only the next action', () => {
  const successOutput = source.slice(
    source.indexOf('function successOutput'),
    source.indexOf('function UserFlow')
  )
  expect(successOutput).toContain('Open a NEW terminal window and run:  codex')
  expect(successOutput).toContain('Fully quit Codex desktop')
  expect(successOutput).toContain('run:  claude')
  expect(successOutput).not.toContain('Installing Codex CLI')
  expect(successOutput).not.toContain('Reading the current complete Codex model catalog')
  expect(successOutput).not.toContain('Backed up old Codex files')
  expect(successOutput).not.toContain('collaboration/subagents')
})

test('developer guides explain where commands run and where configuration is written', () => {
  expect(source).toContain('这些命令在哪里运行？')
  expect(source).toContain('每个黑色命令框都要点击“复制”')
  expect(source).toContain('不要粘贴到浏览器地址栏、Codex 聊天框或文件编辑器')
  expect(source).toContain('写入 AnyRouters 配置')
  expect(source).toContain('~/.codex/auth.json')
  expect(source).toContain('~/.codex/config.toml')
  expect(source).toContain('~/.codex/model-catalog-anyrouters-gpt56.json')
  expect(source).toContain("tool: 'codex-config'")
  expect(source).toContain('以后 Codex 升级后，重新执行这一行即可刷新完整模型目录')
})
