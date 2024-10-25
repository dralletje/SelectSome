let browser = chrome;

let creating; // A global promise to avoid concurrency issues
async function setupOffscreenDocument(offscreenUrl) {
  // Check all windows controlled by the service worker to see if one
  // of them is the offscreen document with the given path
  const existingContexts = await browser.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl],
  });

  if (existingContexts.length > 0) {
    return;
  }

  // create offscreen document
  if (creating) {
    await creating;
  } else {
    creating = browser.offscreen.createDocument({
      url: offscreenUrl,
      reasons: ["MATCH_MEDIA"],
      justification: "Use window.matchMedia to determine the theme color.",
    });
    await creating;
    creating = null;
  }
}

/**
 * @param {string} query
 * @returns {Promise<MediaQueryList>}
 */
export let matchMedia = async (query) => {
  let url = new URL("./matchMedia-offscreen.html", import.meta.url).toString();
  await setupOffscreenDocument(url);

  // Send message to offscreen document
  return await browser.runtime.sendMessage({
    type: "matchMedia",
    target: "offscreen",
    data: query,
  });
};
