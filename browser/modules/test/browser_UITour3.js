/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

let gTestTab;
let gContentAPI;
let gContentWindow;

Components.utils.import("resource:///modules/UITour.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");

requestLongerTimeout(2);

function test() {
  UITourTest();
}

let tests = [
  function test_info_icon(done) {
    let popup = document.getElementById("UITourTooltip");
    let title = document.getElementById("UITourTooltipTitle");
    let desc = document.getElementById("UITourTooltipDescription");
    let icon = document.getElementById("UITourTooltipIcon");
    let buttons = document.getElementById("UITourTooltipButtons");

    // Disable the animation to prevent the mouse clicks from hitting the main
    // window during the transition instead of the buttons in the popup.
    popup.setAttribute("animate", "false");

    popup.addEventListener("popupshown", function onPopupShown() {
      popup.removeEventListener("popupshown", onPopupShown);

      is(title.textContent, "a title", "Popup should have correct title");
      is(desc.textContent, "some text", "Popup should have correct description text");

      let imageURL = getRootDirectory(gTestPath) + "image.png";
      imageURL = imageURL.replace("chrome://mochitests/content/", "https://example.com/");
      is(icon.src, imageURL,  "Popup should have correct icon shown");

      is(buttons.hasChildNodes(), false, "Popup should have no buttons");

      done();
    });

    gContentAPI.showInfo("urlbar", "a title", "some text", "image.png");
  },
  function test_info_buttons_1(done) {
    let popup = document.getElementById("UITourTooltip");
    let title = document.getElementById("UITourTooltipTitle");
    let desc = document.getElementById("UITourTooltipDescription");
    let icon = document.getElementById("UITourTooltipIcon");

    popup.addEventListener("popupshown", function onPopupShown() {
      popup.removeEventListener("popupshown", onPopupShown);

      is(title.textContent, "another title", "Popup should have correct title");
      is(desc.textContent, "moar text", "Popup should have correct description text");

      let imageURL = getRootDirectory(gTestPath) + "image.png";
      imageURL = imageURL.replace("chrome://mochitests/content/", "https://example.com/");
      is(icon.src, imageURL,  "Popup should have correct icon shown");

      let buttons = document.getElementById("UITourTooltipButtons");
      is(buttons.childElementCount, 2, "Popup should have two buttons");

      is(buttons.childNodes[0].getAttribute("label"), "Button 1", "First button should have correct label");
      is(buttons.childNodes[0].getAttribute("image"), "", "First button should have no image");

      is(buttons.childNodes[1].getAttribute("label"), "Button 2", "Second button should have correct label");
      is(buttons.childNodes[1].getAttribute("image"), imageURL, "Second button should have correct image");

      popup.addEventListener("popuphidden", function onPopupHidden() {
        popup.removeEventListener("popuphidden", onPopupHidden);
        ok(true, "Popup should close automatically");

        executeSoon(function() {
          is(gContentWindow.callbackResult, "button1", "Correct callback should have been called");

          done();
        });
      });

      EventUtils.synthesizeMouseAtCenter(buttons.childNodes[0], {}, window);
    });

    let buttons = gContentWindow.makeButtons();
    gContentAPI.showInfo("urlbar", "another title", "moar text", "./image.png", buttons);
  },
  function test_info_buttons_2(done) {
    let popup = document.getElementById("UITourTooltip");
    let title = document.getElementById("UITourTooltipTitle");
    let desc = document.getElementById("UITourTooltipDescription");
    let icon = document.getElementById("UITourTooltipIcon");

    popup.addEventListener("popupshown", function onPopupShown() {
      popup.removeEventListener("popupshown", onPopupShown);

      is(title.textContent, "another title", "Popup should have correct title");
      is(desc.textContent, "moar text", "Popup should have correct description text");

      let imageURL = getRootDirectory(gTestPath) + "image.png";
      imageURL = imageURL.replace("chrome://mochitests/content/", "https://example.com/");
      is(icon.src, imageURL,  "Popup should have correct icon shown");

      let buttons = document.getElementById("UITourTooltipButtons");
      is(buttons.childElementCount, 2, "Popup should have two buttons");

      is(buttons.childNodes[0].getAttribute("label"), "Button 1", "First button should have correct label");
      is(buttons.childNodes[0].getAttribute("image"), "", "First button should have no image");

      is(buttons.childNodes[1].getAttribute("label"), "Button 2", "Second button should have correct label");
      is(buttons.childNodes[1].getAttribute("image"), imageURL, "Second button should have correct image");

      popup.addEventListener("popuphidden", function onPopupHidden() {
        popup.removeEventListener("popuphidden", onPopupHidden);
        ok(true, "Popup should close automatically");

        executeSoon(function() {
          is(gContentWindow.callbackResult, "button2", "Correct callback should have been called");

          done();
        });
      });

      EventUtils.synthesizeMouseAtCenter(buttons.childNodes[1], {}, window);
    });

    let buttons = gContentWindow.makeButtons();
    gContentAPI.showInfo("urlbar", "another title", "moar text", "./image.png", buttons);
  },

  function test_info_close_button(done) {
    let popup = document.getElementById("UITourTooltip");
    let closeButton = document.getElementById("UITourTooltipClose");

    popup.addEventListener("popupshown", function onPopupShown() {
      popup.removeEventListener("popupshown", onPopupShown);
      EventUtils.synthesizeMouseAtCenter(closeButton, {}, window);
      executeSoon(function() {
        is(gContentWindow.callbackResult, "closeButton", "Close button callback called");
        done();
      });
    });

    let infoOptions = gContentWindow.makeInfoOptions();
    gContentAPI.showInfo("urlbar", "Close me", "X marks the spot", null, null, infoOptions);
  },

  function test_info_target_callback(done) {
    let popup = document.getElementById("UITourTooltip");
    popup.addEventListener("popupshown", function onPopupShown() {
      popup.removeEventListener("popupshown", onPopupShown);
      PanelUI.show().then(() => {
        is(gContentWindow.callbackResult, "target", "target callback called");
        is(gContentWindow.callbackData.target, "appMenu", "target callback was from the appMenu");
        is(gContentWindow.callbackData.type, "popupshown", "target callback was from the mousedown");
        popup.removeAttribute("animate");
        done();
      });
    });

    let infoOptions = gContentWindow.makeInfoOptions();
    gContentAPI.showInfo("appMenu", "I want to know when the target is clicked", "*click*", null, null, infoOptions);
  },

  function test_getConfiguration_selectedSearchEngine(done) {
    Services.search.init(rv => {
      ok(Components.isSuccessCode(rv), "Search service initialized");
      let engine = Services.search.defaultEngine;
      gContentAPI.getConfiguration("selectedSearchEngine", (data) => {
        is(data.searchEngineIdentifier, engine.identifier, "Correct engine identifier");
        done();
      });
    });
  },

  function test_setSearchTerm(done) {
    const TERM = "UITour Search Term";
    gContentAPI.setSearchTerm(TERM);

    let searchbar = document.getElementById("searchbar");
    // The UITour gets to the searchbar element through a promise, so the value setting
    // only happens after a tick.
    waitForCondition(() => searchbar.value == TERM, done, "Correct term set");
  },

  function test_clearSearchTerm(done) {
    gContentAPI.setSearchTerm("");

    let searchbar = document.getElementById("searchbar");
    // The UITour gets to the searchbar element through a promise, so the value setting
    // only happens after a tick.
    waitForCondition(() => searchbar.value == "", done, "Search term cleared");
  },

  function test_openSearchPanel(done) {
    let searchbar = document.getElementById("searchbar");

    // If suggestions are enabled, the panel will attempt to use the network to connect
    // to the suggestions provider, causing the test suite to fail.
    Services.prefs.setBoolPref("browser.search.suggest.enabled", false);
    registerCleanupFunction(() => {
      Services.prefs.clearUserPref("browser.search.suggest.enabled");
    });

    ok(!searchbar.textbox.open, "Popup starts as closed");
    gContentAPI.openSearchPanel(() => {
      ok(searchbar.textbox.open, "Popup was opened");
      searchbar.textbox.closePopup();
      ok(!searchbar.textbox.open, "Popup was closed");
      done();
    });
  },

];
