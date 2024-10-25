let browser = chrome;

/**
 * Wrapper to do some basic routing on extension messaging
 * @param {string} type
 * @param {(message: any, sender: chrome.runtime.MessageSender) => Promise<any>} fn
 * @return {void}
 */
export let registerMethod = (type, fn) => {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === type) {
      fn(message, sender)
        .then((result) => {
          return { type: "resolve", value: result };
        })
        .catch((err) => {
          return {
            type: "reject",
            value: { message: err.message, stack: err.stack },
          };
        })
        .then((x) => sendResponse(x));
      return true;
    }
  });
};
