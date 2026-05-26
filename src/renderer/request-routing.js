'use strict';

function subscribeGenerationRouting({ ollama, requestId, onChunk, onError }) {
  const unsubChunkRaw = ollama.onChatChunk((data) => {
    if (data.requestId !== requestId) return;
    onChunk(data);
  });

  const unsubErrorRaw = ollama.onChatError((data) => {
    if (data.requestId !== requestId) return;
    onError(data);
  });

  let unsubscribed = false;

  const unsubChunk = () => {
    if (unsubscribed) return;
    unsubChunkRaw();
  };

  const unsubError = () => {
    if (unsubscribed) return;
    unsubErrorRaw();
  };

  const unsubscribeAll = () => {
    if (unsubscribed) return;
    unsubscribed = true;
    unsubChunkRaw();
    unsubErrorRaw();
  };

  return {
    unsubChunk,
    unsubError,
    unsubscribeAll,
  };
}

module.exports = {
  subscribeGenerationRouting,
};