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
import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { getUserModels, getUserGroups } from './api'
import { ChatHistory } from './components/chat-history'
import { PlaygroundChat } from './components/playground-chat'
import { PlaygroundInput } from './components/playground-input'
import { usePlaygroundState, useChatHandler, useChatSessions } from './hooks'
import { createUserMessage, createLoadingAssistantMessage } from './lib'
import { setEditImageHandler } from './lib/image-edit-bridge'
import type { Message as MessageType } from './types'

export function Playground() {
  const { t } = useTranslation()
  const {
    config,
    parameterEnabled,
    models,
    groups,
    setModels,
    setGroups,
    updateConfig,
  } = usePlaygroundState()

  // Conversations (ChatGPT-style history). The active session is the source of
  // truth for messages, replacing the old single-conversation storage.
  const {
    sessions,
    activeId,
    messages,
    updateMessages,
    newChat,
    selectChat,
    renameChat,
    deleteChat,
  } = useChatSessions()

  const { sendChat, stopGeneration, isGenerating } = useChatHandler({
    config,
    parameterEnabled,
    onMessageUpdate: updateMessages,
  })

  // Edit dialog state
  const [editingMessageKey, setEditingMessageKey] = useState<string | null>(
    null
  )

  // Images staged to send with the next message (data URLs). Sources: clicking
  // "edit" on a generated picture, dragging a file onto the composer, pasting an
  // image, or the Attach menu. Sent as image_url parts so the model sees them
  // (multi-turn image editing for Nano Banana; vision for text models). Shown as
  // removable thumbnail chips above the input until sent or cleared.
  const [pendingImages, setPendingImages] = useState<string[]>([])

  const addPendingImages = useCallback((urls: string[]) => {
    const valid = urls.filter((u) => u && u.startsWith('data:image/'))
    if (valid.length) setPendingImages((prev) => [...prev, ...valid])
  }, [])
  const removePendingImage = useCallback((idx: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  // Load models.
  // `t` below is only a fallback-message helper, not a data input, so it is
  // intentionally kept out of the query cache key.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const { data: modelsData, isLoading: isLoadingModels } = useQuery({
    queryKey: ['playground-models'],
    queryFn: async () => {
      try {
        return await getUserModels()
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t('Failed to load playground models')
        )
        return []
      }
    },
  })

  // Load groups.
  // See note above: `t` is a fallback-message helper, not a cache input.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const { data: groupsData } = useQuery({
    queryKey: ['playground-groups'],
    queryFn: async () => {
      try {
        return await getUserGroups()
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t('Failed to load playground groups')
        )
        return []
      }
    },
  })

  // Update models when data changes
  useEffect(() => {
    if (!modelsData) return

    setModels(modelsData)

    // Set default model if current model is not available
    const isCurrentModelValid = modelsData.some((m) => m.value === config.model)
    if (modelsData.length > 0 && !isCurrentModelValid) {
      updateConfig('model', modelsData[0].value)
    }
  }, [modelsData, config.model, setModels, updateConfig])

  // Update groups when data changes
  useEffect(() => {
    if (!groupsData) return

    setGroups(groupsData)

    const hasCurrentGroup = groupsData.some((g) => g.value === config.group)
    if (!hasCurrentGroup && groupsData.length > 0) {
      const fallback =
        groupsData.find((g) => g.value === 'default')?.value ??
        groupsData[0].value
      updateConfig('group', fallback)
    }
  }, [groupsData, setGroups, config.group, updateConfig])

  const handleSendMessage = (text: string) => {
    // Attach any staged images (edited picture / dropped / pasted / uploaded) so
    // the model receives them as image_url parts.
    const attached = pendingImages.length ? pendingImages : undefined
    const userMessage = createUserMessage(text, attached)
    const assistantMessage = createLoadingAssistantMessage()

    const newMessages = [...messages, userMessage, assistantMessage]
    updateMessages(newMessages)
    setPendingImages([])

    // Send chat request
    sendChat(newMessages)
  }

  // Register the in-chat "edit image" handler: clicking the edit button on a
  // generated image stages it (a chip appears above the input); the user then
  // types what to change and sends. Cleared on unmount.
  useEffect(() => {
    setEditImageHandler((dataUrl: string) => {
      addPendingImages([dataUrl])
      toast.info(t('Describe how to edit the image, then send'))
    })
    return () => setEditImageHandler(null)
  }, [t, addPendingImages])

  const handleCopyMessage = (message: MessageType) => {
    // Copy is handled in MessageActions component
    // eslint-disable-next-line no-console
    console.log('Message copied:', message.key)
  }

  const handleRegenerateMessage = (message: MessageType) => {
    // Find the message index and regenerate from there
    const messageIndex = messages.findIndex((m) => m.key === message.key)
    if (messageIndex === -1) return

    // Remove messages after this one and regenerate
    const messagesUpToHere = messages.slice(0, messageIndex)
    const loadingMessage = createLoadingAssistantMessage()
    const newMessages = [...messagesUpToHere, loadingMessage]

    updateMessages(newMessages)
    sendChat(newMessages)
  }

  const handleEditMessage = useCallback((message: MessageType) => {
    setEditingMessageKey(message.key)
  }, [])

  const handleEditOpenChange = useCallback((open: boolean) => {
    if (!open) setEditingMessageKey(null)
  }, [])

  // Apply edit and optionally re-submit from the edited user message
  const applyEdit = useCallback(
    (newContent: string, submit: boolean) => {
      if (!editingMessageKey) return
      const index = messages.findIndex((m) => m.key === editingMessageKey)
      if (index === -1) return

      const updated = messages.map((m) =>
        m.key === editingMessageKey
          ? { ...m, versions: [{ ...m.versions[0], content: newContent }] }
          : m
      )

      setEditingMessageKey(null)

      if (!submit || updated[index].from !== 'user') {
        updateMessages(updated)
        return
      }

      const toSubmit = [
        ...updated.slice(0, index + 1),
        createLoadingAssistantMessage(),
      ]
      updateMessages(toSubmit)
      sendChat(toSubmit)
    },
    [editingMessageKey, messages, updateMessages, sendChat]
  )

  const handleDeleteMessage = (message: MessageType) => {
    const newMessages = messages.filter((m) => m.key !== message.key)
    updateMessages(newMessages)
  }

  return (
    <div className='relative flex size-full overflow-hidden'>
      <ChatHistory
        sessions={sessions}
        activeId={activeId}
        disabled={isGenerating}
        onNewChat={newChat}
        onSelect={selectChat}
        onRename={renameChat}
        onDelete={deleteChat}
      />

      <div className='relative flex min-w-0 flex-1 flex-col overflow-hidden'>
        {/* Full-width scroll container: scrolling works even over side whitespace */}
        <div className='flex flex-1 flex-col overflow-hidden'>
          <PlaygroundChat
            messages={messages}
            onCopyMessage={handleCopyMessage}
            onRegenerateMessage={handleRegenerateMessage}
            onEditMessage={handleEditMessage}
            onDeleteMessage={handleDeleteMessage}
            isGenerating={isGenerating}
            editingKey={editingMessageKey}
            onCancelEdit={handleEditOpenChange}
            onSaveEdit={(newContent) => applyEdit(newContent, false)}
            onSaveEditAndSubmit={(newContent) => applyEdit(newContent, true)}
          />
        </div>

        {/* Input area: center content and constrain to the same container width */}
        <div className='mx-auto w-full max-w-4xl'>
          <PlaygroundInput
            disabled={isGenerating}
            groups={groups}
            groupValue={config.group}
            isGenerating={isGenerating}
            isModelLoading={isLoadingModels}
            modelValue={config.model}
            models={models}
            onGroupChange={(value) => updateConfig('group', value)}
            onModelChange={(value) => updateConfig('model', value)}
            onStop={stopGeneration}
            onSubmit={handleSendMessage}
            images={pendingImages}
            onAddImages={addPendingImages}
            onRemoveImage={removePendingImage}
          />
        </div>
      </div>
    </div>
  )
}
