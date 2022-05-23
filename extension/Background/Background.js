import { tint_image } from "./tint_image.js";
import { browser } from "../Vendor/Browser.js";

let BROWSERACTION_ICON = "/Icons/Icon_32.png";

let browser_info_promise = browser.runtime.getBrowserInfo
  ? browser.runtime.getBrowserInfo()
  : Promise.resolve({ name: "Chrome" });
let is_firefox = browser_info_promise.then(
  (browser_info) => browser_info.name === "Firefox",
);

/** @param {import("webextension-polyfill-ts").Tabs.Tab} tab */
let get_host_config = async (tab) => {
  let host = new URL(tab.url).host;
  let config = (await browser.storage.sync.get(host))[host];
  return {
    disabled: false,
    ...config,
  };
};

/**
 * Wrapper to do some basic routing on extension messaging
 * @param {string} type
 * @param {(message: any, sender: import("webextension-polyfill-ts").Runtime.MessageSender) => Promise<any>} fn
 * @return {void}
 */
let onMessage = (type, fn) => {
  browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === type) {
      return fn(message, sender)
        .then((result) => {
          return { type: "resolve", value: result };
        })
        .catch((err) => {
          return {
            type: "reject",
            value: { message: err.message, stack: err.stack },
          };
        });
    }
  });
};

onMessage("get_windowed_config", async (message, sender) => {
  return await get_host_config(sender.tab);
});

/** @type {{ [tabid: number]: Promise<boolean> }} */
let current_port_promises = {};
/**
 * Check if we can connect with the Windowed content script in a tab
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
let ping_content_script = async (tabId) => {
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
          resolve(false);
        });
      });
      return await current_port_promises[tabId];
    }
  } finally {
    delete current_port_promises[tabId];
  }
};

/**
 * Sooooo this is pretty silly, but I can't use `window.matchMedia` in MV3 service workers,
 * so I have to execute the script in the page... Hope the reviewers don't mind me adding
 * "scripting" permission just for this :P
 * @param {import("webextension-polyfill-ts").Tabs.Tab} tab
 * @param {string} query
 */
let matchMedia = async (tab, query) => {
  let x = await browser.scripting.executeScript({
    target: { tabId: tab.id },
    func: (query) => {
      return window.matchMedia(query).matches;
    },
    args: [query],
  });
  return { matches: x[0].result };
};

/**
 * Tries to figure out the default icon color
 * - Tries to use the current theme on firefox
 * - Else defaults to light and dark mode
 * @param {import("webextension-polyfill-ts").Tabs.Tab} tab
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
    return (await matchMedia(tab, "(prefers-color-scheme: dark)")).matches
      ? "rgba(255,255,255,0.8)"
      : "rgb(250, 247, 252)";
  }

  return (await matchMedia(tab, "(prefers-color-scheme: dark)")).matches
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
  port.disconnect();
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
 * @param {import("webextension-polyfill-ts").Tabs.Tab} tab
 */
let update_button_on_tab = async (tab) => {
  let has_contentscript_active =
    tab.status === "complete" && (await ping_content_script(tab.id));

  // A specific exception for about:blank so, on firefox,
  // when you customize your menu bar, ~windowed~ select-some is at it's most beautiful.
  if (has_contentscript_active === false && tab.url === "about:blank") {
    await apply_browser_action(tab.id, {
      icon: await tint_image(BROWSERACTION_ICON, await icon_theme_color(tab)),
      title: `Select Some`,
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
      tab.url.match(/^https?:\/\/support\.mozilla\.org/))
  ) {
    await apply_browser_action(tab.id, {
      icon: await tint_image(BROWSERACTION_ICON, "rgba(208, 2, 27, .22)"),
      title: `For security reasons, SelectSome is not supported on this domain (${tab.url}).`,
    });
    return;
  }

  // So if the tab is loaded, and it is not an extra secure domain,
  // it means windowed is not loaded for some reason. So I tell that.
  if (tab.status === "complete" && has_contentscript_active === false) {
    // await apply_browser_action(tab.id, {
    //   icon: await tint_image(BROWSERACTION_ICON, "#D0021B"),
    //   title:
    //     "This page needs to be reloaded for SelectSome to activate. Click here to reload.",
    // });

    // Instead of asking the user to reload the page (as they should with Windowed),
    // here I can just inject the script and it'll work! :D
    browser.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["Content.js"],
    });
  }

  // From here I figure out what the user has configured for Windowed on this domain,
  // and show a specific icon and title for each of those.
  let host = new URL(tab.url).host;
  let config = await get_host_config(tab);
  if (config.disabled) {
    // DISABLED
    await apply_browser_action(tab.id, {
      icon: await tint_image(BROWSERACTION_ICON, "rgba(133, 133, 133, 0.5)"),
      title: `Select Some is disabled on ${host}, click to re-activate`,
    });
    await notify_tab_state(tab.id, { disabled: true });
  } else {
    // ENABLED FUNCTION
    await apply_browser_action(tab.id, {
      icon: await tint_image(BROWSERACTION_ICON, await icon_theme_color(tab)),
      title: `Select Some is enabled on ${host}`,
    });
    await notify_tab_state(tab.id, { disabled: false });
  }
};

browser.action.onClicked.addListener(async (tab) => {
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
