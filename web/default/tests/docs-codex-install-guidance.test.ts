import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../src/features/docs/index.tsx', import.meta.url),
  'utf8'
)

test('Codex guides combine install and upgrade with a visible release note', () => {
  expect(source).toContain('第三步：快速安装与升级')
  expect(source).toContain('当前版本更新于：2026年7月16日')
  expect(source).toContain('支持 ChatGPT 5.6 全系列')
  expect(source).toContain('使用 Codex 原生模型目录，不再写入自定义模型目录')
  expect(source).toContain('保留 Codex 原生子代理、工具能力和已有推理强度')
  const notice = source.slice(
    source.indexOf('function CodexUpdateNotice()'),
    source.indexOf('function ApiTakeoverNotice')
  )
  expect(notice).toContain('Codex 原生子代理')
  expect(source).not.toContain('解决部分计价')
  expect(source).toContain('点击命令框下方「复制」')
  expect(source).toContain('Codex 升级后重复本步即可')
  expect(source).toContain("<strong className='font-semibold'>")
})

test('one-line setup explains its scope below the command', () => {
  expect(source).toContain('运行前请注意')
  expect(source).toContain('这条命令会安装或升级')
  expect(source).toContain('这条命令只更新')
  expect(source).toMatch(/不会删除聊天记录，也不会修改系统代理、AWS\s+凭据或其他工具配置/)
  expect(source).toMatch(/不会写入自定义模型目录，也不会关闭\s+Codex 原生子代理/)
  expect(source).toContain('命令会清理已知的旧 Codex/OpenAI 中转环境覆盖')
  expect(source).toContain('不会创建、替换或停用网站 Key')
  expect(source).toContain('不会修改系统代理、AWS 凭据或 CODEX_HOME')
  expect(source).toContain('写入位置和分步验证见下方「开发者」')
  expect(source).toContain(
    '<CodeBlock code={command} />\n              <ApiTakeoverNotice tool={tool} />'
  )
  expect(source).not.toContain('清理会导致调用串线的同类旧环境变量/旧配置')
  expect(source).not.toContain('基础连接已经关闭')
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
  expect(source).toContain('每个命令框都要点击“复制”')
  expect(source).toContain('不要粘贴到浏览器地址栏、工具聊天输入框或文件编辑器')
  expect(source).toContain('写入 AnyRouters 配置')
  expect(source).toContain('auth.json')
  expect(source).toContain('~/.codex/config.toml')
  expect(source).not.toContain('~/.codex/anyrouters-api-key')
  expect(source).toContain('当前 shell 启动文件中的 OPENAI_API_KEY')
  expect(source).toContain('macOS launchctl 中的 OPENAI_API_KEY')
  expect(source).not.toContain('~/.codex/model-catalog-anyrouters-gpt56.json')
  expect(source).toContain("tool: 'codex-config'")
  expect(source).toContain('~/.codex/anyrouters-native-backup-时间戳')
  expect(source).toContain('model_catalog_json')
  expect(source).toContain('OPENAI_API_KEY')
  expect(source).toContain('OPENAI_BASE_URL')
  expect(source).toContain('CODEX_API_KEY')
  expect(source).toContain('Windows 用户环境')
  expect(source).toContain('Windows 用户环境变量 OPENAI_API_KEY')
  expect(source).toMatch(/OPENAI_API_KEY[\s\S]*设置为你刚粘贴的现有 AnyRouters Key/)
  expect(source).toContain('macOS launchctl')
  expect(source).toContain('如果其他工具仍依赖这些变量，请为它们单独配置')
  expect(source).toMatch(/Codex 升级后可重新执行这一行，复核当前版本的原生模型能力/)
  expect(source).toContain('在终端输入区键入')
})

test('every secondary guide states the UI location, final action, and success check', () => {
  const ccSwitch = source.slice(
    source.indexOf('function CcSwitchGuide'),
    source.indexOf('function CherryStudioGuide')
  )
  expect(ccSwitch).toContain('顶部选择 <strong>Claude Code</strong>')
  expect(ccSwitch).toContain('右上角')
  expect(ccSwitch).toMatch(/把整段 JSON 粘贴到 cc-switch 的 JSON\s+编辑框/)
  expect(ccSwitch).toContain('保存并启用 AnyRouters')
  expect(ccSwitch).toContain('收到回复就表示切换成功')
  expect(ccSwitch).toContain('遇到旧配置冲突？')
  expect(ccSwitch).toContain('旧服务商配置或系统环境变量')
  expect(ccSwitch).toMatch(/旧\s+API 地址/)
  expect(ccSwitch).toContain('不要删除当前')
  expect(ccSwitch).toContain('/model')
  expect(ccSwitch).toContain('不能关闭旧服务商配置或清除环境变量覆盖')
  expect(ccSwitch).not.toContain('<DeveloperFlow')

  const cherry = source.slice(
    source.indexOf('function CherryStudioGuide'),
    source.indexOf('function codexImageInstallCommand')
  )
  expect(cherry).toContain('「设置」→「模型服务」')
  expect(cherry).toContain('下面不是一条命令')
  expect(cherry).toContain("value: ANTHROPIC_BASE")
  expect(cherry).toContain('「检查」')
  expect(cherry).toContain('收到回复就表示配置完成')
  expect(cherry).not.toContain('from openai import OpenAI')
  const addProvider = cherry.indexOf('然后点击「添加」')
  const addModel = cherry.indexOf('添加模型')
  const checkConnection = cherry.indexOf('输入框右侧的「检查」')
  expect(addProvider).toBeGreaterThan(-1)
  expect(addModel).toBeGreaterThan(addProvider)
  expect(checkConnection).toBeGreaterThan(addModel)

  const image = source.slice(
    source.indexOf('function CodexImageGuide'),
    source.indexOf('type GuideEntry')
  )
  expect(image).toContain('~/Downloads/anyrouters-image.zip')
  expect(image).toContain('~/.codex/skills/anyrouters-image')
  expect(image).toContain('等 Codex 明确回复“安装完成”')
  expect(image).toContain('Command-Q 完全退出 Codex')
  expect(image).toContain('桌面「AnyRouters图片」文件夹并自动打开')
})
