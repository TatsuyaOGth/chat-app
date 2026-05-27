'use strict';

(function initRequestRouting(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.RequestRouting = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, () => {
  function subscribeGenerationRouting({ ollama, requestId, onChunk, onError, onProgress, onSearchInfo }) {
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

    const unsubscribeAll = () => {
      if (unsubscribed) return;
      unsubscribed = true;
      unsubChunkRaw();
      unsubErrorRaw();
      unsubProgressRaw();
      unsubSearchInfoRaw();
    };

    return {
      unsubChunk,
      unsubError,
      unsubProgress,
      unsubSearchInfo: unsubSearchInfoRaw,
      unsubscribeAll,
    };
  }

  return {
    subscribeGenerationRouting,
  };
});