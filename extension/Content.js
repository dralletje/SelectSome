/** @param {Node} element */
function* parents(element) {
  while (element.parentElement != null) {
    yield element.parentElement;
    element = element.parentElement;
  }
}

/**
 * Get closest parent element of two elements
 * @param {Node} element1
 * @param {Node} element2
 */
let get_closest_parent = (element1, element2) => {
  if (element1 === element2 && element1 instanceof HTMLElement) {
    return element1;
  }
  for (let parent of parents(element1)) {
    if (parent === element2 || parent.contains(element2)) {
      return parent;
    }
  }
  return null;
};

/**
 * @param {Range} a
 * @param {Range} b
 */
let ranges_are_equal = (a, b) => {
  return (
    a != null &&
    b != null &&
    a.startContainer === b.startContainer &&
    a.startOffset === b.startOffset &&
    a.endContainer === b.endContainer &&
    a.endOffset === b.endOffset
  );
};

/** @param {Selection} selection */
function selects_whole_element(selection) {
  if (selection.anchorNode !== selection.focusNode) {
    return false;
  }

  let element = selection.anchorNode;
  let [start, end] =
    selection.anchorOffset > selection.focusOffset
      ? [selection.focusOffset, selection.anchorOffset]
      : [selection.anchorOffset, selection.focusOffset];

  if (start !== 0) {
    return false;
  }

  // if (element.nodeType === Node.TEXT_NODE) {
  if (element instanceof Text) {
    let text_node = /** @type {Text} */ (element);
    return text_node.wholeText.length === end;
    // } else if (element.nodeType === Node.ELEMENT_NODE) {
  } else if (element instanceof HTMLElement) {
    return element.childNodes.length === end;
  } else {
    throw new Error("Unknown node type");
  }
}

/**
 * @param {Selection} selection
 */
let get_naive_selection_parent = (selection) => {
  if (selection.anchorNode == null || selection.focusNode == null) {
    return;
  }

  if (selects_whole_element(selection)) {
    if (selection.anchorNode.parentElement != null) {
      return selection.anchorNode.parentElement;
    }
  } else {
    let parent = get_closest_parent(selection.anchorNode, selection.focusNode);
    if (parent != null) {
      return parent;
    }
  }
  return null;
};

/** @param {Selection} selection */
let get_current_range = (selection) => {
  if (selection.rangeCount !== 0) {
    return selection.getRangeAt(0);
  } else {
    return null;
  }
};

/**
 * @param {DocumentOrShadowRoot} document
 * @returns {Selection}
 */
let get_selection_possibly_in_shadowroot = (document) => {
  let selection = document.getSelection();

  if (
    selection.anchorNode === selection.focusNode &&
    selection.anchorOffset === selection.focusOffset
  ) {
    // One full element selected, possibly has a shadow root
    let selected_element =
      selection.anchorNode?.childNodes?.[selection.anchorOffset];

    // @ts-ignore
    if (selected_element?.shadowRoot != null) {
      // @ts-ignore
      return get_selection_possibly_in_shadowroot(selected_element.shadowRoot);
    } else {
      return selection;
    }
  } else {
    return selection;
  }
};

/**
 * @param {DocumentOrShadowRoot} document
 * @returns {Element | null}
 */
let get_active_element = (document) => {
  let activeElement = document.activeElement;

  if (activeElement?.shadowRoot != null) {
    return get_active_element(activeElement.shadowRoot);
  } else {
    return activeElement;
  }
};

/**
 * This is the "state" of this extension, keeping track of the selections for every ctrl+a and ctrl+shift+a press.
 * @type {Array<Range>}
 */
let selection_expansion_stack = [];

let config = {
  disabled: false,
};

let is_mac = navigator.platform.match(/(Mac|iPhone|iPod|iPad)/i);

window.addEventListener(
  "keydown",
  function BetterSelectAllKeyboardListener(event) {
    if (config.disabled) return;
    if (event.repeat) return;

    if (event.key === "a" && (is_mac ? event.metaKey : event.ctrlKey)) {
      if (event.defaultPrevented) return;

      if (event.repeat) return;

      let activeElement = get_active_element(document);
      if (
        activeElement == null ||
        activeElement.tagName === "TEXTAREA" ||
        activeElement.tagName === "INPUT" ||
        activeElement.tagName === "IFRAME"
      ) {
        return;
      }

      let selection = get_selection_possibly_in_shadowroot(document);
      let range = get_current_range(selection);
      if (range == null) return;
      let original_range = range.cloneRange();

      // let parent = get_naive_selection_parent(selection);
      let parent =
        original_range.commonAncestorContainer instanceof HTMLElement
          ? original_range.commonAncestorContainer
          : original_range.commonAncestorContainer.parentElement;

      if (event.shiftKey) {
        // Need to have a current range and a range to go back to
        if (selection_expansion_stack.length > 1) {
          let [current_selection_node, previous_range, ...rest] =
            selection_expansion_stack;

          if (
            ranges_are_equal(original_range, current_selection_node) &&
            previous_range != null
          ) {
            event.preventDefault();

            let current_range = get_current_range(selection);
            current_range.setStart(
              previous_range.startContainer,
              previous_range.startOffset,
            );
            current_range.setEnd(
              previous_range.endContainer,
              previous_range.endOffset,
            );
            selection_expansion_stack = [previous_range, ...rest];
          }
        }
      } else {
        if (parent == null) {
          if (
            activeElement !== activeElement.getRootNode() &&
            activeElement !== activeElement.getRootNode()["body"]
          ) {
            parent = /** @type {HTMLElement} */ (document.activeElement);
          } else {
            return;
          }
        }

        if (parent === document.body) return;

        event.preventDefault();

        // Keep selecting parents until you have a different selection text
        // - Watches for shadow doms, and will try to escape it (DOES NOT YET WORK)
        // TODO: Do something cool with specific elements
        // - Selections in <dt> should first expand to just the <dd> after it, and vice versa
        // - Something cool with detecting headers and first selecting upto the closest header.
        //   Pages like wikipedia don't care about divs, they have everything stacked with just headers for directions.
        let initial_selection_text = selection.toString().trim();
        selection.selectAllChildren(parent);
        while (selection.toString().trim() === initial_selection_text) {
          // The shadow root expansion stuff, doesn't work yet
          if (parent.parentElement == null) {
            let root = parent.getRootNode();
            if (root instanceof ShadowRoot) {
              parent = /** @type {HTMLElement} */ (root.host);
              selection = /** @type {DocumentOrShadowRoot} */ (
                /** @type {unknown} */ (parent.getRootNode())
              ).getSelection();
              selection.selectAllChildren(parent);
              initial_selection_text = selection.toString().trim();
            } else {
              // In the other case it the document, and the document is the final parent
              return;
            }
          } else {
            parent = parent.parentElement;
            selection.selectAllChildren(parent);
          }
        }

        let new_range = get_current_range(selection).cloneRange();
        let [current_selection_node, ...rest] = selection_expansion_stack;
        if (ranges_are_equal(original_range, current_selection_node)) {
          selection_expansion_stack = [new_range, ...selection_expansion_stack];
        } else {
          selection_expansion_stack = [new_range, original_range];
        }
      }
    }
  },
);

try {
  // @ts-ignore
  const browser = /** @type {import("webextension-polyfill-ts").Browser} */ (
    globalThis.chrome
  );
  /**
   * @param {{ type: string, [key: string]: any }} message
   */
  let send_chrome_message = async (message) => {
    let { type, value } = await browser.runtime.sendMessage(message);
    if (type === "resolve") {
      return value;
    } else {
      let err = new Error(value.message);
      err.stack = value.stack;
      // err.stack = [
      //   ...x.value.stack.split('\n'),
      //   'From postMessage to background page',
      //   ...stack,
      // ].join('\n');
      throw err;
    }
  };
  /**
   * @returns {Promise<{
   *  disabled: boolean,
   * }>}
   */
  let get_host_config_local = async () => {
    return await send_chrome_message({
      type: "get_selectsome_config",
    });
  };
  let check_disabled_state = async () => {
    try {
      config = await get_host_config_local();
    } catch (err) {
      // prettier-ignore
      console.warn(`[SelectSome] Error while checking if SelectSome is enabled or not`, err)
    }
  };

  check_disabled_state();

  browser.runtime.onConnect.addListener(async (port) => {
    port.postMessage({ type: "I_exists_ping" });
    check_disabled_state();
  });
} catch (error) {}
