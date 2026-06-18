/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { Link } from '@tanstack/react-router'
import { ArrowRight, KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

const BASE_URL = 'https://api.anyrouters.com/v1'

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className='overflow-x-auto rounded-xl border bg-muted/40 p-4 text-[13px] leading-relaxed'>
      <code className='font-mono'>{children}</code>
    </pre>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className='mt-10'>
      <h2 className='text-sm font-semibold tracking-tight text-foreground'>
        {title}
      </h2>
      <div className='mt-3 space-y-3'>{children}</div>
    </section>
  )
}

export function Docs() {
  const { t } = useTranslation()

  return (
    <div className='h-full overflow-y-auto'>
      <div className='mx-auto max-w-3xl px-6 py-10'>
        <h1 className='text-2xl font-semibold tracking-tight'>
          {t('Quickstart')}
        </h1>
        <p className='mt-2 text-sm text-muted-foreground'>
          {t('One OpenAI- and Anthropic-compatible endpoint for every model.')}
        </p>

        <Section title={t('API Base URL')}>
          <CodeBlock>{BASE_URL}</CodeBlock>
        </Section>

        <Section title={t('Get your API key')}>
          <Button size='sm' render={<Link to='/keys' />}>
            <KeyRound className='size-4' />
            {t('Create API Keys')}
          </Button>
        </Section>

        <Section title={t('Code examples')}>
          <CodeBlock>{`curl ${BASE_URL}/chat/completions \\
  -H "Authorization: Bearer sk-anyrouters-..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`}</CodeBlock>
          <CodeBlock>{`from openai import OpenAI

client = OpenAI(
    base_url="${BASE_URL}",
    api_key="sk-anyrouters-...",
)
resp = client.chat.completions.create(
    model="claude-opus-4",  # or gpt-5, gemini-2.5-pro
    messages=[{"role": "user", "content": "Hello"}],
)
print(resp.choices[0].message.content)`}</CodeBlock>
        </Section>

        <Section title={t('Use in coding tools')}>
          <p className='text-xs font-medium text-muted-foreground'>Claude Code</p>
          <CodeBlock>{`export ANTHROPIC_BASE_URL=https://api.anyrouters.com
export ANTHROPIC_AUTH_TOKEN=sk-anyrouters-...
export ANTHROPIC_MODEL=claude-opus-4`}</CodeBlock>
          <p className='text-xs font-medium text-muted-foreground'>
            Codex / OpenAI-compatible
          </p>
          <CodeBlock>{`export OPENAI_BASE_URL=${BASE_URL}
export OPENAI_API_KEY=sk-anyrouters-...`}</CodeBlock>
        </Section>

        <Section title={t('Available models')}>
          <Button variant='outline' size='sm' render={<Link to='/pricing' />}>
            {t('Model Marketplace')}
            <ArrowRight className='size-4' />
          </Button>
        </Section>
      </div>
    </div>
  )
}
