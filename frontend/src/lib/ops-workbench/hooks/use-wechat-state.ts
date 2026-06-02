"use client";

import { useState } from 'react';
import type {
  OpsWorkbenchWechatConversationSnapshotResult,
  WechatBatchState,
  WechatExecutionMode,
} from '../runtime';
import type { OpsWorkbenchWechatDraftReadyResult } from '../router';

type WechatSendState = {
  sent?: boolean;
  targetContact?: string;
  stage?: string;
  message?: string;
  screenshotPath?: string;
};

type WechatAlignState = {
  ok?: boolean;
  stage?: string;
  targetContact?: string;
  activeConversation?: string;
  currentConversation?: string;
  message?: string;
  screenshotPath?: string;
};

export function useWechatState() {
  const [wechatBatchState, setWechatBatchState] = useState<WechatBatchState | null>(null);
  const [wechatReplyContact, setWechatReplyContact] = useState('');
  const [wechatReplyDraft, setWechatReplyDraft] = useState('');
  const [wechatReplyContext, setWechatReplyContext] = useState('');
  const [wechatConversationSnapshot, setWechatConversationSnapshot] =
    useState<OpsWorkbenchWechatConversationSnapshotResult | null>(null);
  const [wechatDraftReadyState, setWechatDraftReadyState] =
    useState<OpsWorkbenchWechatDraftReadyResult | null>(null);
  const [wechatSendState, setWechatSendState] = useState<WechatSendState | null>(null);
  const [wechatExecutionMode, setWechatExecutionMode] = useState<WechatExecutionMode>('auto-send');
  const [wechatAlignState, setWechatAlignState] = useState<WechatAlignState | null>(null);

  const resetWechatState = () => {
    setWechatBatchState(null);
    setWechatReplyContact('');
    setWechatReplyDraft('');
    setWechatReplyContext('');
    setWechatConversationSnapshot(null);
    setWechatDraftReadyState(null);
    setWechatSendState(null);
    setWechatAlignState(null);
  };

  return {
    wechatBatchState,
    setWechatBatchState,
    wechatReplyContact,
    setWechatReplyContact,
    wechatReplyDraft,
    setWechatReplyDraft,
    wechatReplyContext,
    setWechatReplyContext,
    wechatConversationSnapshot,
    setWechatConversationSnapshot,
    wechatDraftReadyState,
    setWechatDraftReadyState,
    wechatSendState,
    setWechatSendState,
    wechatExecutionMode,
    setWechatExecutionMode,
    wechatAlignState,
    setWechatAlignState,
    resetWechatState,
  };
}
