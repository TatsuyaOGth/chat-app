'use strict';

(function initGenerationLifecycle(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.GenerationLifecycle = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, () => {
  function createGenerationLifecycle({
    requestId,
    generation,
    paramsSnapshot,
    sessionId,
    clearUiState,
    onRemoveThinking,
    onAppendContent,
    onCancelled,
    onError,
    onPersistAssistant,
    onDiscardAssistant,
    onAfterFinish,
    onFinishResolved,
    unsubChunk,
    unsubError,
    unsubProgress,
    unsubSearchInfo,
  }) {
    let responseText = '';
    let done = false;
    let finishCalled = false;
    let thinkingRemoved = false;

    function removeThinking() {
      if (thinkingRemoved) return false;
      thinkingRemoved = true;
      onRemoveThinking();
      return true;
    }

    async function finish() {
      if (finishCalled) return;
      finishCalled = true;
      unsubChunk();
      unsubError();
      if (typeof unsubProgress === 'function') unsubProgress();
      if (typeof unsubSearchInfo === 'function') unsubSearchInfo();
      clearUiState(generation);

      if (generation.discardAssistantBubble) {
        onDiscardAssistant(generation);
      }

      if (!generation.discardAssistantBubble && done && responseText) {
        await onPersistAssistant({
          sessionId,
          paramsSnapshot,
          responseText,
        });
      }

      onAfterFinish();
      onFinishResolved();
    }

    async function handleChunk({ requestId: rid, content, done: isDone }) {
      if (rid !== requestId) return;

      if (content) {
        removeThinking();
        responseText += content;
        onAppendContent(responseText);
      }

      if (isDone) {
        done = true;
        await finish();
      }
    }

    async function handleError({ requestId: rid, error, cancelled }) {
      if (rid !== requestId) return;

      removeThinking();

      if (cancelled) {
        onCancelled({
          generation,
          responseText,
        });
      } else {
        onError(error);
      }

      await finish();
    }

    function updateThinkingLabel(loaded) {
      if (thinkingRemoved) return;
      return loaded ? '考え中...' : 'モデルをロード中...';
    }

    return {
      finish,
      handleChunk,
      handleError,
      updateThinkingLabel,
      getResponseText: () => responseText,
      isThinkingRemoved: () => thinkingRemoved,
    };
  }

  return {
    createGenerationLifecycle,
  };
});