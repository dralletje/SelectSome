import { tint_image } from "./utils/tint_image.js";
import { matchMedia } from "./utils/matchMedia/matchMedia.js";
import { ping_content_script } from "./utils/ping_content_script.js";
import { registerMethod } from "./utils/extensionRPC.js";

// import { browser } from "../Browser/BackgroundBrowser.js";
let browser = chrome;

let BROWSERACTION_ICON = "/Icons/Icon_32.png";
let NEEDS_RELOAD_TITLE =
  "This page needs to be reloaded for SelectSome to activate. Click here to reload.";

let browser_info_promise = browser.runtime.getBrowserInfo
  ? browser.runtime.getBrowserInfo()
  : Promise.resolve({ name: "Chrome" });
let is_firefox = browser_info_promise.then(
  (browser_info) => browser_info.name === "Firefox",
);

/** @param {chrome.tabs.Tab} tab */
let get_host_config = async (tab) => {
  if (tab.url == null) {
    throw new Error("tab.url == null");
  }

  let host = new URL(tab.url).host;
  let config = (await browser.storage.sync.get(host))[host];
  return {
    disabled: false,
    ...config,
  };
};

registerMethod("get_selectsome_config", async (message, sender) => {
  if (sender.tab == null) {
    throw new Error("sender.tab == null");
  }

  return await get_host_config(sender.tab);
});

/**
 * Tries to figure out the default icon color
 * - Tries to use the current theme on firefox
 * - Else defaults to light and dark mode
 * @param {chrome.tabs.Tab} tab
 * @returns {Promise<string>}
 */
let icon_theme_color = async (tab) => {
  if (await is_firefox) {
    let theme = await browser.theme.getCurrent(tab.windowId);
    if (theme?.colors?.icons != null) {
      return theme.colors.icons;
    }
    if (theme?.colors?.popup_text != null) {
      return theme.colors.popup_text;
    }
    return (await matchMedia("(prefers-color-scheme: dark)")).matches
      ? "rgba(255,255,255,0.8)"
      : "rgb(250, 247, 252)";
  }

  return (await matchMedia("(prefers-color-scheme: dark)")).matches
    ? "rgba(255,255,255,0.8)"
    : "#5f6368";
};

/**
 * This looks a bit weird (and honestly it is) but it opens a port to the content script on a page,
 * and then the page knows it should reload it's settings.
 * TODO? Should I close the port?
 * @param {number} tabId
 * @param {any} properties
 */
let notify_tab_state = async (tabId, properties) => {
  let port = browser.tabs.connect(tabId);
  // port.postMessage(JSON.stringify({ method: 'notify', data: properties }))
};

/**
 * Shorthand for setting the browser action icon on a tab
 * @param {number} tabId
 * @param {{ icon: ImageData, title: string }} action
 */
let apply_browser_action = async (tabId, action) => {
  await browser.action.setIcon({
    tabId: tabId,
    imageData: action.icon,
  });
  await browser.action.setTitle({
    tabId: tabId,
    title: action.title,
  });
};

/**
 * @param {chrome.tabs.Tab} tab
 */
let update_button_on_tab = async (tab) => {
  if (tab.id == null || tab.url == null) {
    throw new Error("tab.id == null || tab.url == null");
  }

  let has_contentscript_active =
    tab.status === "complete" && (await ping_content_script(tab.id));

  // A specific exception for about:blank so, on firefox,
  // when you customize your menu bar, ~windowed~ select-some is at it's most beautiful.
  if (has_contentscript_active === false && tab.url === "about:blank") {
    await apply_browser_action(tab.id, {
      icon: await tint_image(BROWSERACTION_ICON, await icon_theme_color(tab)),
      title: `SelectSome`,
    });
    return;
  }

  // On some domains windowed will never work, because it is blocked by the browser.
  // To avoid user confusion with the "You have to reload" message,
  // I show a descriptive error 💁‍♀️
  if (
    has_contentscript_active === false &&
    (tab.url.match(/^about:/) ||
      tab.url.match(/^chrome:\/\//) ||
      tab.url.match(/^edge:\/\//) ||
      tab.url.match(/^https?:\/\/chrome\.google\.com/) ||
      tab.url.match(/^https?:\/\/support\.mozilla\.org/) ||
      tab.url.match(/^https?:\/\/addons.mozilla.org/))
  ) {
    await apply_browser_action(tab.id, {
      icon: await tint_image(BROWSERACTION_ICON, "rgba(208, 2, 27, .22)"),
      title: `For security reasons, SelectSome is not supported on this domain (${tab.url}).`,
    });
    return;
  }

  // if (tab.status === "complete" && has_contentscript_active === false) {
  //   await apply_browser_action(tab.id, {
  //     icon: await tint_image(BROWSERACTION_ICON, "#D0021B"),
  //     title:
  //       "This page needs to be reloaded for SelectSome to activate. Click here to reload.",
  //   });
  //   return;
  // }

  // So if the tab is loaded, and it is not an extra secure domain,
  // it means SelectSome is not loaded for some reason. So I tell that.
  if (tab.status === "complete" && has_contentscript_active === false) {
    /// I used to inject the content script here, but manifest v3 makes that require a bunch of permissions..
    /// So instead I show a message to the user to reload the page.
    await apply_browser_action(tab.id, {
      icon: await tint_image(BROWSERACTION_ICON, "#D0021B"),
      title: NEEDS_RELOAD_TITLE,
    });
    return;
  }

  // From here I figure out what the user has configured for SelectSome on this domain,
  // and show a specific icon and title for each of those.
  let host = new URL(tab.url).host;
  let config = await get_host_config(tab);
  if (config.disabled) {
    // DISABLED
    await apply_browser_action(tab.id, {
      icon: await tint_image(BROWSERACTION_ICON, "rgba(133, 133, 133, 0.5)"),
      title: `SelectSome is disabled on ${host}, click to re-activate`,
    });
    await notify_tab_state(tab.id, { disabled: true });
  } else {
    // ENABLED FUNCTION
    await apply_browser_action(tab.id, {
      icon: await tint_image(BROWSERACTION_ICON, await icon_theme_color(tab)),
      title: `SelectSome is enabled on ${host}`,
    });
    await notify_tab_state(tab.id, { disabled: false });
  }
};

/**
 * @param {chrome.tabs.Tab} tab
 */
let getActionTitle = async (tab) => {
  return new Promise((resolve) => {
    browser.action.getTitle(
      {
        tabId: tab.id,
      },
      resolve,
    );
  });
};

browser.action.onClicked.addListener(async (tab) => {
  if (tab.id == null || tab.url == null) {
    throw new Error("tab.id == null || tab.url == null");
  }

  if ((await getActionTitle(tab)) === NEEDS_RELOAD_TITLE) {
    browser.tabs.reload(tab.id);
    return;
  }

  let host = new URL(tab.url).host;
  let { [host]: previous_config } = await browser.storage.sync.get(host);
  await browser.storage.sync.set({
    [host]: {
      ...previous_config,
      disabled: !(previous_config?.disabled ?? false),
    },
  });
  await update_button_on_tab(tab);
});

// Events where I refresh the browser action button
browser.runtime.onInstalled.addListener(async () => {
  let all_tabs = await browser.tabs.query({});
  for (let tab of all_tabs) {
    await update_button_on_tab(tab);
  }
});
browser.tabs.onUpdated.addListener(async (tabId, changed, tab) => {
  if (changed.url != null || changed.status != null) {
    await update_button_on_tab(tab);
  }
});
// Not sure if I need this one -
// only reason I need it is for when one would toggle Enabled/Disabled
browser.tabs.onActivated.addListener(async ({ tabId }) => {
  let tab = await browser.tabs.get(tabId);
  await update_button_on_tab(tab);
});
// Because I load this as a module now, I am making sure this code is ran as much as possible
(async () => {
  let all_tabs = await browser.tabs.query({});
  for (let tab of all_tabs) {
    await update_button_on_tab(tab);
  }
})();
