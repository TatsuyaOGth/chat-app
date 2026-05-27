'use strict';

(function initRequestRouting(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.RequestRouting = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, () => {
  function subscribeGenerationRouting({ ollama, requestId, onChunk, onError, onProgress, onSearchInfo, onThinking }) {
    const unsubChunkRaw = ollama.onChatChunk((data) => {
      if (data.requestId !== requestId) return;
      onChunk(data);
    });

    const unsubErrorRaw = ollama.onChatError((data) => {
      if (data.requestId !== requestId) return;
      onError(data);
    });

    const unsubProgressRaw = typeof onProgress === 'function'
      ? ollama.onChatProgress((data) => {
        if (data.requestId !== requestId) return;
        onProgress(data);
      })
      : () => {};

    const unsubSearchInfoRaw = typeof onSearchInfo === 'function'
      ? ollama.onChatSearchInfo((data) => {
        if (data.requestId !== requestId) return;
        onSearchInfo(data);
      })
      : () => {};

    const unsubThinkingRaw = typeof onThinking === 'function'
      ? ollama.onChatThinking((data) => {
        if (data.requestId !== requestId) return;
        onThinking(data);
      })
      : () => {};

    let unsubscribed = false;

    const unsubChunk = () => {
      if (unsubscribed) return;
      unsubChunkRaw();
    };

    const unsubError = () => {
      if (unsubscribed) return;
      unsubErrorRaw();
    };

    const unsubProgress = () => {
      if (unsubscribed) return;
      unsubProgressRaw();
    };

    const unsubThinking = () => {
      if (unsubscribed) return;
      unsubThinkingRaw();
    };

    const unsubSearchInfo = () => {
      if (unsubscribed) return;
      unsubSearchInfoRaw();
    };

    const unsubscribeAll = () => {
      if (unsubscribed) return;
      unsubscribed = true;
      unsubChunkRaw();
      unsubErrorRaw();
      unsubProgressRaw();
      unsubSearchInfoRaw();
      unsubThinkingRaw();
    };

    return {
      unsubChunk,
      unsubError,
      unsubProgress,
      unsubThinking,
      unsubSearchInfo,
      unsubscribeAll,
    };
  }

  return {
    subscribeGenerationRouting,
  };
});