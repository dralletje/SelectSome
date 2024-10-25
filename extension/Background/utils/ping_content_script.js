let browser = chrome;
// import { browser } from "../../Browser/BackgroundBrowser.js";

/** @type {{ [tabid: number]: Promise<boolean> }} */
let current_port_promises = {};
/**
 * Check if we can connect with the SelectSome content script in a tab
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
export let ping_content_script = async (tabId) => {
  try {
    if (current_port_promises[tabId] != null) {
      return await current_port_promises[tabId];
    } else {
      current_port_promises[tabId] = new Promise((resolve, reject) => {
        let port = browser.tabs.connect(tabId);
        port.onMessage.addListener((message) => {
          resolve(true);
          port.disconnect();
        });
        port.onDisconnect.addListener((p) => {
          /// Just need to check for errors so chrome doesn't show a warning
          browser.runtime.lastError;
          resolve(false);
        });
      });
      return await current_port_promises[tabId];
    }
  } finally {
    delete current_port_promises[tabId];
  }
};
