let polyfill_for_chrome = {
  tabs: {
    /**
     * @param {number} tabId
     * @returns {import("./Browser").Port}
     */
    connect: (tabId) => {
      return chrome.tabs.connect(tabId);
    },
  },
  runtime: {
    get lastError() {
      return chrome.runtime.lastError;
    },
    /** @type {import("./Browser").Event<(message: any, sender: import("./Browser").MessageSender, sendResponse: (message: any) => void) => Promise<any> | boolean>} */
    onMessage: {
      addListener: (fn) => {
        chrome.runtime.onMessage.addListener(
          (message, sender, sendResponse) => {
            let result = fn(message, sender, sendResponse);
            if (typeof result === "boolean") {
              return true;
            } else if ("then" in result) {
              return result.then((x) => sendResponse(x));
            } else {
              return;
            }
          },
        );
      },
      removeListener: (fn) => chrome.runtime.onMessage.removeListener(fn),
      hasListeners: chrome.runtime.onMessage.hasListeners,
    },
  },
  get action() {
    if (!("action" in chrome)) {
      throw new Error(
        "chrome.action is not available, add an 'action' key to manifest.json",
      );
    }

    return {
      /**
       * @param {chrome.action.TabIconDetails} details
       */
      setIcon: (details) => {
        return chrome.action.setIcon(details);
      },
    };
  },
};

/**
 * @type {typeof polyfill_for_chrome}
 */
export let browser =
  "browser" in globalThis ? globalThis.browser : polyfill_for_chrome;
