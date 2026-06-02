"use client";

import { useState, useCallback } from 'react';
import type { DouyinBatchState, DouyinBrowserMode, DouyinSendMode } from '../runtime';
import { buildDouyinModeStartingState } from '../runtime';

const INITIAL_DOUYIN_STATE: DouyinBatchState = {
  active: false,
  paused: false,
  completed: false,
  processedCount: 0,
};

export function useDouyinState() {
  const [douyinBatchState, setDouyinBatchState] = useState<DouyinBatchState | null>(null);
  const [activeDouyinBrowserSessionId, setActiveDouyinBrowserSessionId] = useState<string | null>(null);
  const [activeDouyinBrowserMode, setActiveDouyinBrowserMode] = useState<DouyinBrowserMode | null>(null);
  const [douyinSendMode, setDouyinSendMode] = useState<DouyinSendMode>('auto-send');
  const [douyinCreatorName, setDouyinCreatorName] = useState('');
  const [douyinCommentUser, setDouyinCommentUser] = useState('');
  const [douyinCommentText, setDouyinCommentText] = useState('');
  const [douyinReplyDraft, setDouyinReplyDraft] = useState('');
  const [douyinReplyContext, setDouyinReplyContext] = useState('');
  const [douyinWarmup, setDouyinWarmup] = useState(false);
  const [douyinDraftSnapshot, setDouyinDraftSnapshot] = useState<string | null>(null);
  const [douyinSendTransitionState, setDouyinSendTransitionState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  const startDouyinSession = useCallback((mode: DouyinBrowserMode) => {
    setDouyinBatchState(buildDouyinModeStartingState(INITIAL_DOUYIN_STATE, { mode }));
    setActiveDouyinBrowserMode(mode);
    setDouyinWarmup(true);
  }, []);

  const resetDouyinState = useCallback(() => {
    setDouyinBatchState(null);
    setActiveDouyinBrowserSessionId(null);
    setActiveDouyinBrowserMode(null);
    setDouyinWarmup(false);
    setDouyinDraftSnapshot(null);
    setDouyinSendTransitionState('idle');
  }, []);

  return {
    douyinBatchState,
    setDouyinBatchState,
    activeDouyinBrowserSessionId,
    setActiveDouyinBrowserSessionId,
    activeDouyinBrowserMode,
    setActiveDouyinBrowserMode,
    douyinSendMode,
    setDouyinSendMode,
    douyinCreatorName,
    setDouyinCreatorName,
    douyinCommentUser,
    setDouyinCommentUser,
    douyinCommentText,
    setDouyinCommentText,
    douyinReplyDraft,
    setDouyinReplyDraft,
    douyinReplyContext,
    setDouyinReplyContext,
    douyinWarmup,
    setDouyinWarmup,
    douyinDraftSnapshot,
    setDouyinDraftSnapshot,
    douyinSendTransitionState,
    setDouyinSendTransitionState,
    startDouyinSession,
    resetDouyinState,
  };
}
