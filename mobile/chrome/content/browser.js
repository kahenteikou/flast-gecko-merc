// -*- Mode: js2; tab-width: 2; indent-tabs-mode: nil; js2-basic-offset: 2; js2-skip-preprocessor-directives: t; -*-
/*
 * ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Mozilla Mobile Browser.
 *
 * The Initial Developer of the Original Code is
 * Mozilla Corporation.
 * Portions created by the Initial Developer are Copyright (C) 2008
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Brad Lassey <blassey@mozilla.com>
 *   Mark Finkle <mfinkle@mozilla.com>
 *   Aleks Totic <a@totic.org>
 *   Johnathan Nightingale <johnath@mozilla.com>
 *   Stuart Parmenter <stuart@mozilla.com>
 *   Taras Glek <tglek@mozilla.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

let Cc = Components.classes;
let Ci = Components.interfaces;
let Cu = Components.utils;

const FINDSTATE_FIND = 0;
const FINDSTATE_FIND_AGAIN = 1;
const FINDSTATE_FIND_PREVIOUS = 2;

Cu.import("resource://gre/modules/SpatialNavigation.js");

function getBrowser() {
  return Browser.selectedBrowser;
}

const kDefaultTextZoom = 1.2;
const kDefaultBrowserWidth = 1024;

var ws = null;
var ih = null;

var Browser = {
  _canvasBrowser : null,
  _tabs : [],
  _browsers : [],
  _selectedTab : null,
  windowUtils: window.QueryInterface(Ci.nsIInterfaceRequestor)
                     .getInterface(Ci.nsIDOMWindowUtils),
  _isStartup : true,

  startup: function() {
    var self = this;

    // initalize the CanvasBrowser
    this._canvasBrowser = new CanvasBrowser(document.getElementById("browser-canvas"));

    // initialize the WidgetStack
    let browserContainer = document.getElementById("browser-container");
    ws = new WidgetStack(browserContainer);
    
    // during startup a lot of viewportHandler calls happen due to content and window resizes
    ws.beginUpdateBatch();
    
    // XXX this should live elsewhere
    window.gSidebarVisible = false;
    function panHandler(vr, dx, dy) {
      if (dx) {
        let visibleNow = ws.isWidgetVisible("tabs-container") || ws.isWidgetVisible("browser-controls");
        if (visibleNow && !gSidebarVisible) {
          BrowserUI.showToolbar(URLBAR_FORCE);
        }
        else if (!visibleNow && gSidebarVisible) {
          BrowserUI.showToolbar();
        }
        gSidebarVisible = visibleNow;
      }

      // move checkerboard
      browserContainer.style.backgroundPosition = -vr.left + "px " + -vr.top + "px";

      // this is really only necessary for maemo, where we don't
      // always repaint fast enough.
      self.windowUtils.processUpdates();
    }

    ws.setPanHandler(panHandler);

    function resizeHandler(e) {
      if (e.target != window)
        return;

      let w = window.innerWidth;
      let maximize = (document.documentElement.getAttribute("sizemode") == "maximized");
      if (maximize && w > screen.width)
        return;

      let h = window.innerHeight;
      
      // Tell the UI to resize the browser controls before calling  updateSize
      BrowserUI.sizeControls(w, h);

      // Resize our container...
      let containerStyle = browserContainer.style;
      containerStyle.width = containerStyle.maxWidth = w + "px";
      containerStyle.height = containerStyle.maxHeight = h + "px";

      // Resize the browsers...
      let browsers = Browser.browsers;
      if (browsers) {
        let scaledH = (kDefaultBrowserWidth * (h / w));
        for (let i=0; i<browsers.length; i++) {
          let browserStyle = browsers[i].style;
          browserStyle.height = scaledH + "px";
        }
      }
      
      ws.updateSize(w, h);
    }
    window.addEventListener("resize", resizeHandler, false);

    function viewportHandler(bounds, boundsSizeChanged) {
      self._canvasBrowser.viewportHandler(bounds, boundsSizeChanged);
    }
    ws.setViewportHandler(viewportHandler);

    // initialize input handling
    ih = new InputHandler();

    BrowserUI.init();

    window.controllers.appendController(this);
    window.controllers.appendController(BrowserUI);

    var ios = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
    var styleSheets = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);

    // Should we hide the cursors
    var hideCursor = gPrefService.getBoolPref("browser.ui.cursor") == false;
    if (hideCursor) {
      window.QueryInterface(Ci.nsIDOMChromeWindow).setCursor("none");

      var styleURI = ios.newURI("chrome://browser/content/content.css", null, null);
      styleSheets.loadAndRegisterSheet(styleURI, styleSheets.AGENT_SHEET);
    }

    // load styles for scrollbars
    var styleURI = ios.newURI("chrome://browser/content/scrollbars.css", null, null);
    styleSheets.loadAndRegisterSheet(styleURI, styleSheets.AGENT_SHEET);

    var os = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
    os.addObserver(gXPInstallObserver, "xpinstall-install-blocked", false);
    os.addObserver(gXPInstallObserver, "xpinstall-download-started", false);
    os.addObserver(gSessionHistoryObserver, "browser:purge-session-history", false);

    // XXX hook up memory-pressure notification to clear out tab browsers
    //os.addObserver(function(subject, topic, data) self.destroyEarliestBrowser(), "memory-pressure", false);

    window.QueryInterface(Ci.nsIDOMChromeWindow).browserDOMWindow = new nsBrowserAccess();

    let browsers = document.getElementById("browsers");
    browsers.addEventListener("command", this._handleContentCommand, false);
    browsers.addEventListener("DOMUpdatePageReport", gPopupBlockerObserver.onUpdatePageReport, false);

    /* Initialize Spatial Navigation */
    var canvasBrowser = this.canvasBrowser;
    function panCallback(aElement) {
      if (!aElement)
        return;

      canvasBrowser.ensureElementIsVisible(aElement);
    }
    // Init it with the "browsers" element, which will receive keypress events
    // for all of our <browser>s
    SpatialNavigation.init(browsers, panCallback);

    /* Login Manager */
    Cc["@mozilla.org/login-manager;1"].getService(Ci.nsILoginManager);

    /* Command line arguments/initial homepage */
    // If this is an intial window launch (was a nsICommandLine passed via window params)
    // we execute some logic to load the initial launch page
    if (window.arguments && window.arguments[0]) {
      var whereURI = null;

      try {
        // Try to access the commandline
        var cmdLine = window.arguments[0].QueryInterface(Ci.nsICommandLine);

        try {
          // Check for and use a default homepage
          whereURI = gPrefService.getCharPref("browser.startup.homepage");
        } catch (e) {}

        // Check for and use a single commandline parameter
        if (cmdLine.length == 1) {
          // Assume the first arg is a URI if it is not a flag
          var uri = cmdLine.getArgument(0);
          if (uri != "" && uri[0] != '-') {
            whereURI = cmdLine.resolveURI(uri);
            if (whereURI)
              whereURI = whereURI.spec;
          }
        }

        // Check for the "url" flag
        var uriFlag = cmdLine.handleFlagWithParam("url", false);
        if (uriFlag) {
          whereURI = cmdLine.resolveURI(uriFlag);
          if (whereURI)
            whereURI = whereURI.spec;
        }
      } catch (e) {}

      if (whereURI)
        this.addTab(whereURI, true);
    }

    // Re-enable plugins if we had previously disabled them. We should get rid of
    // this code eventually...
    if (gPrefService.prefHasUserValue("temporary.disablePlugins")) {
      gPrefService.clearUserPref("temporary.disablePlugins");
      this.setPluginState(true);
    }
  },

  shutdown: function() {
    BrowserUI.uninit();

    var os = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
    os.removeObserver(gXPInstallObserver, "xpinstall-install-blocked");
    os.removeObserver(gXPInstallObserver, "xpinstall-download-started");
    os.removeObserver(gSessionHistoryObserver, "browser:purge-session-history");
    window.controllers.removeController(this);
    window.controllers.removeController(BrowserUI);
  },

  updateViewportSize: function() {
    var [w, h] = this._canvasBrowser._effectiveContentAreaDimensions.map(Math.ceil);

    if (!this._currentViewportBounds ||
        w != this._currentViewportBounds.width ||
        h != this._currentViewportBounds.height) {
      this._currentViewportBounds = {width: w, height: h};
      let bounds = { top: 0, left: 0, right: Math.max(800, w), bottom: Math.max(480, h) }
      ws.setViewportBounds(bounds);
    }
  },

  setPluginState: function(enabled)
  {
    var phs = Cc["@mozilla.org/plugin/host;1"].getService(Ci.nsIPluginHost);
    var plugins = phs.getPluginTags({ });
    for (var i = 0; i < plugins.length; ++i)
      plugins[i].disabled = !enabled;
  },

  get canvasBrowser() {
    return this._canvasBrowser;
  },

  get browsers() {
    return this._browsers;
  },

  /**
   * Return the currently active <browser> object
   */
  get selectedBrowser() {
    return this._selectedTab.browser;
  },

  getTabAtIndex: function(index) {
    if (index > this._tabs.length || index < 0)
      return null;
    return this._tabs[index];
  },

  getTabFromChrome: function(chromeTab) {
    for (var t = 0; t < this._tabs.length; t++) {
      if (this._tabs[t].chromeTab == chromeTab)
        return this._tabs[t];
    }
    return null;
  },

  addTab: function(uri, bringFront) {
    let newTab = new Tab();
    newTab.create(uri);
    this._tabs.push(newTab);
    this._browsers.push(newTab.browser);

    let event = document.createEvent("Events");
    event.initEvent("TabOpen", true, false);
    newTab.chromeTab.dispatchEvent(event);

    if (bringFront)
      this.selectedTab = newTab;

    return newTab;
  },

  closeTab: function(tab) {
    if (tab instanceof XULElement)
      tab = this.getTabFromChrome(tab);

    if (!tab)
      return;

    let tabIndex = this._tabs.indexOf(tab);

    let nextTab = this._selectedTab;
    if (this._selectedTab == tab) {
      nextTab = this.getTabAtIndex(tabIndex + 1) || this.getTabAtIndex(tabIndex - 1);
      if (!nextTab)
        return;
    }

    let event = document.createEvent("Events");
    event.initEvent("TabClose", true, false);
    tab.chromeTab.dispatchEvent(event);

    this.selectedTab = nextTab;

    tab.destroy();
    this._tabs.splice(tabIndex, 1);
    this._browsers.splice(tabIndex, 1);

    // redraw the tabs
    for (let t = tabIndex; t < this._tabs.length; t++)
      this._tabs[t].updateThumbnail();
  },

  get selectedTab() {
    return this._selectedTab;
  },

  set selectedTab(tab) {
    if (tab instanceof XULElement)
      tab = this.getTabFromChrome(tab);

    if (!tab || this._selectedTab == tab)
      return;

    let firstTab = this._selectedTab == null;
    this._selectedTab = tab;

    ws.beginUpdateBatch();
    this._canvasBrowser.setCurrentBrowser(this.selectedBrowser, firstTab);
    document.getElementById("tabs").selectedItem = tab.chromeTab;

    ws.panTo(0, -BrowserUI.toolbarH);

    if (!firstTab) {
      let webProgress = this.selectedBrowser.webProgress;
      let securityUI = this.selectedBrowser.securityUI;

      try {
        tab._listener.onLocationChange(webProgress, null, this.selectedBrowser.currentURI);
        if (securityUI)
          tab._listener.onSecurityChange(webProgress, null, securityUI.state);
      } catch (e) {
        // don't inhibit other listeners or following code
        Components.utils.reportError(e);
      }

      let event = document.createEvent("Events");
      event.initEvent("TabSelect", true, false);
      tab.chromeTab.dispatchEvent(event);
    }
    ws.endUpdateBatch(true);
  },

  supportsCommand: function(cmd) {
    var isSupported = false;
    switch (cmd) {
      case "cmd_fullscreen":
        isSupported = true;
        break;
      default:
        isSupported = false;
        break;
    }
    return isSupported;
  },

  isCommandEnabled: function(cmd) {
    return true;
  },

  doCommand: function(cmd) {
    switch (cmd) {
      case "cmd_fullscreen":
        window.fullScreen = !window.fullScreen;
        break;
    }
  },

  getNotificationBox: function() {
    return document.getElementById("notifications");
  },

  findState: FINDSTATE_FIND,
  openFind: function(aState) {
    this.findState = aState;
    var findbar = document.getElementById("findbar");
    if (!findbar.browser)
      findbar.browser = this.selectedBrowser;

    var panel = document.getElementById("findbar-container");
    if (panel.hidden) {
      panel.hidden = false;
    }
    this.doFind();
  },

  doFind: function() {
    var findbar = document.getElementById("findbar");
    if (Browser.findState == FINDSTATE_FIND)
      findbar.onFindCommand();
    else
      findbar.onFindAgainCommand(Browser.findState == FINDSTATE_FIND_PREVIOUS);

    var panel = document.getElementById("findbar-container");
    panel.top = window.innerHeight - findbar.getBoundingClientRect().height;
  },

  translatePhoneNumbers: function() {
    let doc = getBrowser().contentDocument;
    // jonas black magic (only match text nodes that contain a sequence of 4 numbers)
    let textnodes = doc.evaluate('//text()[contains(translate(., "0123456789", "^^^^^^^^^^"), "^^^^")]',
                                 doc,
                                 null,
                                 XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
                                 null);
    let s, node, lastLastIndex;
    let re = /(\+?1? ?-?\(?\d{3}\)?[ +-\.]\d{3}[ +-\.]\d{4})/
    for (var i = 0; i < textnodes.snapshotLength; i++) {
      node = textnodes.snapshotItem(i);
      s = node.data;
      if (s.match(re)) {
        s = s.replace(re, "<a href='tel:$1'> $1 </a>");
        try {
          let replacement = doc.createElement("span");
          replacement.innerHTML = s;
          node.parentNode.insertBefore(replacement, node);
          node.parentNode.removeChild(node);
        } catch(e) {
          //do nothing, but continue
        }
      }
    }
  },

  /**
   * Handle command event bubbling up from content.  This allows us to do chrome-
   * privileged things based on buttons in, e.g., unprivileged error pages.
   * Obviously, care should be taken not to trust events that web pages could have
   * synthesized.
   */
  _handleContentCommand: function (aEvent) {
    // Don't trust synthetic events
    if (!aEvent.isTrusted)
      return;

    var ot = aEvent.originalTarget;
    var errorDoc = ot.ownerDocument;

    // If the event came from an ssl error page, it is probably either the "Add
    // Exception…" or "Get me out of here!" button
    if (/^about:neterror\?e=nssBadCert/.test(errorDoc.documentURI)) {
      if (ot == errorDoc.getElementById('exceptionDialogButton')) {
        var params = { exceptionAdded : false };

        try {
          switch (gPrefService.getIntPref("browser.ssl_override_behavior")) {
            case 2 : // Pre-fetch & pre-populate
              params.prefetchCert = true;
            case 1 : // Pre-populate
              params.location = errorDoc.location.href;
          }
        } catch (e) {
          Components.utils.reportError("Couldn't get ssl_override pref: " + e);
        }

        window.openDialog('chrome://pippki/content/exceptionDialog.xul',
                          '','chrome,centerscreen,modal', params);

        // If the user added the exception cert, attempt to reload the page
        if (params.exceptionAdded)
          errorDoc.location.reload();
      }
      else if (ot == errorDoc.getElementById('getMeOutOfHereButton')) {
        // Get the start page from the *default* pref branch, not the user's
        var defaultPrefs = Cc["@mozilla.org/preferences-service;1"]
                          .getService(Ci.nsIPrefService).getDefaultBranch(null);
        var url = "about:blank";
        try {
          url = defaultPrefs.getCharPref("browser.startup.homepage");
          // If url is a pipe-delimited set of pages, just take the first one.
          if (url.indexOf("|") != -1)
            url = url.split("|")[0];
        } catch (e) { /* Fall back on about blank */ }

        Browser.selectedBrowser.loadURI(url, null, null, false);
      }
    }
  }
};

function nsBrowserAccess()
{
}

nsBrowserAccess.prototype = {
  QueryInterface: function(aIID) {
    if (aIID.equals(Ci.nsIBrowserDOMWindow) || aIID.equals(Ci.nsISupports))
      return this;
    throw Components.results.NS_NOINTERFACE;
  },

  openURI: function(aURI, aOpener, aWhere, aContext) {
    var isExternal = (aContext == Ci.nsIBrowserDOMWindow.OPEN_EXTERNAL);
    if (isExternal && aURI && aURI.schemeIs("chrome")) {
      dump("use -chrome command-line option to load external chrome urls\n");
      return null;
    }

    var loadflags = isExternal ?
                       Ci.nsIWebNavigation.LOAD_FLAGS_FROM_EXTERNAL :
                       Ci.nsIWebNavigation.LOAD_FLAGS_NONE;
    var location;
    if (aWhere == Ci.nsIBrowserDOMWindow.OPEN_DEFAULTWINDOW) {
      switch (aContext) {
        case Ci.nsIBrowserDOMWindow.OPEN_EXTERNAL :
          aWhere = gPrefService.getIntPref("browser.link.open_external");
          break;
        default : // OPEN_NEW or an illegal value
          aWhere = gPrefService.getIntPref("browser.link.open_newwindow");
      }
    }

    var newWindow;
    if (aWhere == Ci.nsIBrowserDOMWindow.OPEN_NEWWINDOW) {
      var url = aURI ? aURI.spec : "about:blank";
      newWindow = openDialog("chrome://browser/content/browser.xul", "_blank",
                             "all,dialog=no", url, null, null, null);
    }
    else {
      if (aWhere == Ci.nsIBrowserDOMWindow.OPEN_NEWTAB)
        newWindow = Browser.addTab("about:blank", true).browser.contentWindow;
      else
        newWindow = aOpener ? aOpener.top : browser.contentWindow;
    }

    try {
      var referrer;
      if (aURI) {
        if (aOpener) {
          location = aOpener.location;
          referrer = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService)
                                                            .newURI(location, null, null);
        }
        newWindow.QueryInterface(Ci.nsIInterfaceRequestor)
                 .getInterface(Ci.nsIWebNavigation)
                 .loadURI(aURI.spec, loadflags, referrer, null, null);
      }
      newWindow.focus();
    } catch(e) { }

    return newWindow;
  },

  isTabContentWindow: function(aWindow) {
    return Browser.browsers.some(function (browser) browser.contentWindow == aWindow);
  }
}

/**
 * Utility class to handle manipulations of the identity indicators in the UI
 */
function IdentityHandler() {
  this._stringBundle = document.getElementById("bundle_browser");
  this._staticStrings = {};
  this._staticStrings[this.IDENTITY_MODE_DOMAIN_VERIFIED] = {
    encryption_label: this._stringBundle.getString("identity.encrypted2")
  };
  this._staticStrings[this.IDENTITY_MODE_IDENTIFIED] = {
    encryption_label: this._stringBundle.getString("identity.encrypted2")
  };
  this._staticStrings[this.IDENTITY_MODE_UNKNOWN] = {
    encryption_label: this._stringBundle.getString("identity.unencrypted2")
  };

  this._cacheElements();
}

IdentityHandler.prototype = {

  // Mode strings used to control CSS display
  IDENTITY_MODE_IDENTIFIED       : "verifiedIdentity", // High-quality identity information
  IDENTITY_MODE_DOMAIN_VERIFIED  : "verifiedDomain",   // Minimal SSL CA-signed domain verification
  IDENTITY_MODE_UNKNOWN          : "unknownIdentity",  // No trusted identity information

  // Cache the most recent SSLStatus and Location seen in checkIdentity
  _lastStatus : null,
  _lastLocation : null,

  /**
   * Build out a cache of the elements that we need frequently.
   */
  _cacheElements: function() {
    this._identityBox = document.getElementById("identity-box");
    this._identityPopup = document.getElementById("identity-container");
    this._identityPopupContentBox = document.getElementById("identity-popup-content-box");
    this._identityPopupContentHost = document.getElementById("identity-popup-content-host");
    this._identityPopupContentOwner = document.getElementById("identity-popup-content-owner");
    this._identityPopupContentSupp = document.getElementById("identity-popup-content-supplemental");
    this._identityPopupContentVerif = document.getElementById("identity-popup-content-verifier");
    this._identityPopupEncLabel = document.getElementById("identity-popup-encryption-label");
  },

  /**
   * Helper to parse out the important parts of _lastStatus (of the SSL cert in
   * particular) for use in constructing identity UI strings
  */
  getIdentityData: function() {
    var result = {};
    var status = this._lastStatus.QueryInterface(Ci.nsISSLStatus);
    var cert = status.serverCert;

    // Human readable name of Subject
    result.subjectOrg = cert.organization;

    // SubjectName fields, broken up for individual access
    if (cert.subjectName) {
      result.subjectNameFields = {};
      cert.subjectName.split(",").forEach(function(v) {
        var field = v.split("=");
        this[field[0]] = field[1];
      }, result.subjectNameFields);

      // Call out city, state, and country specifically
      result.city = result.subjectNameFields.L;
      result.state = result.subjectNameFields.ST;
      result.country = result.subjectNameFields.C;
    }

    // Human readable name of Certificate Authority
    result.caOrg =  cert.issuerOrganization || cert.issuerCommonName;
    result.cert = cert;

    return result;
  },

  /**
   * Determine the identity of the page being displayed by examining its SSL cert
   * (if available) and, if necessary, update the UI to reflect this.  Intended to
   * be called by onSecurityChange
   *
   * @param PRUint32 state
   * @param JS Object location that mirrors an nsLocation (i.e. has .host and
   *                           .hostname and .port)
   */
  checkIdentity: function(state, location) {
    var currentStatus = getBrowser().securityUI
                                .QueryInterface(Ci.nsISSLStatusProvider)
                                .SSLStatus;
    this._lastStatus = currentStatus;
    this._lastLocation = location;

    if (state & Ci.nsIWebProgressListener.STATE_IDENTITY_EV_TOPLEVEL)
      this.setMode(this.IDENTITY_MODE_IDENTIFIED);
    else if (state & Ci.nsIWebProgressListener.STATE_SECURE_HIGH)
      this.setMode(this.IDENTITY_MODE_DOMAIN_VERIFIED);
    else
      this.setMode(this.IDENTITY_MODE_UNKNOWN);
  },

  /**
   * Return the eTLD+1 version of the current hostname
   */
  getEffectiveHost: function() {
    // Cache the eTLDService if this is our first time through
    if (!this._eTLDService)
      this._eTLDService = Cc["@mozilla.org/network/effective-tld-service;1"]
                         .getService(Ci.nsIEffectiveTLDService);
    try {
      return this._eTLDService.getBaseDomainFromHost(this._lastLocation.hostname);
    } catch (e) {
      // If something goes wrong (e.g. hostname is an IP address) just fail back
      // to the full domain.
      return this._lastLocation.hostname;
    }
  },

  /**
   * Update the UI to reflect the specified mode, which should be one of the
   * IDENTITY_MODE_* constants.
   */
  setMode: function(newMode) {
    this._identityBox.setAttribute("mode", newMode);
    this.setIdentityMessages(newMode);

    // Update the popup too, if it's open
    if (!this._identityPopup.hidden)
      this.setPopupMessages(newMode);
  },

  /**
   * Set up the messages for the primary identity UI based on the specified mode,
   * and the details of the SSL cert, where applicable
   *
   * @param newMode The newly set identity mode.  Should be one of the IDENTITY_MODE_* constants.
   */
  setIdentityMessages: function(newMode) {
    if (newMode == this.IDENTITY_MODE_DOMAIN_VERIFIED) {
      var iData = this.getIdentityData();

      // We need a port number for all lookups.  If one hasn't been specified, use
      // the https default
      var lookupHost = this._lastLocation.host;
      if (lookupHost.indexOf(':') < 0)
        lookupHost += ":443";

      // Cache the override service the first time we need to check it
      if (!this._overrideService)
        this._overrideService = Cc["@mozilla.org/security/certoverride;1"].getService(Ci.nsICertOverrideService);

      // Verifier is either the CA Org, for a normal cert, or a special string
      // for certs that are trusted because of a security exception.
      var tooltip = this._stringBundle.getFormattedString("identity.identified.verifier",
                                                          [iData.caOrg]);

      // Check whether this site is a security exception. XPConnect does the right
      // thing here in terms of converting _lastLocation.port from string to int, but
      // the overrideService doesn't like undefined ports, so make sure we have
      // something in the default case (bug 432241).
      if (this._overrideService.hasMatchingOverride(this._lastLocation.hostname,
                                                    (this._lastLocation.port || 443),
                                                    iData.cert, {}, {}))
        tooltip = this._stringBundle.getString("identity.identified.verified_by_you");
    }
    else if (newMode == this.IDENTITY_MODE_IDENTIFIED) {
      // If it's identified, then we can populate the dialog with credentials
      iData = this.getIdentityData();
      tooltip = this._stringBundle.getFormattedString("identity.identified.verifier",
                                                      [iData.caOrg]);
    }
    else {
      tooltip = this._stringBundle.getString("identity.unknown.tooltip");
    }

    // Push the appropriate strings out to the UI
    this._identityBox.tooltipText = tooltip;
  },

  /**
   * Set up the title and content messages for the identity message popup,
   * based on the specified mode, and the details of the SSL cert, where
   * applicable
   *
   * @param newMode The newly set identity mode.  Should be one of the IDENTITY_MODE_* constants.
   */
  setPopupMessages: function(newMode) {
    this._identityPopup.setAttribute("mode", newMode);
    this._identityPopupContentBox.className = newMode;

    // Set the static strings up front
    this._identityPopupEncLabel.textContent = this._staticStrings[newMode].encryption_label;

    // Initialize the optional strings to empty values
    var supplemental = "";
    var verifier = "";

    if (newMode == this.IDENTITY_MODE_DOMAIN_VERIFIED) {
      var iData = this.getIdentityData();
      var host = this.getEffectiveHost();
      var owner = this._stringBundle.getString("identity.ownerUnknown2");
      verifier = this._identityBox.tooltipText;
      supplemental = "";
    }
    else if (newMode == this.IDENTITY_MODE_IDENTIFIED) {
      // If it's identified, then we can populate the dialog with credentials
      iData = this.getIdentityData();
      host = this.getEffectiveHost();
      owner = iData.subjectOrg;
      verifier = this._identityBox.tooltipText;

      // Build an appropriate supplemental block out of whatever location data we have
      if (iData.city)
        supplemental += iData.city + "\n";
      if (iData.state && iData.country)
        supplemental += this._stringBundle.getFormattedString("identity.identified.state_and_country",
                                                              [iData.state, iData.country]);
      else if (iData.state) // State only
        supplemental += iData.state;
      else if (iData.country) // Country only
        supplemental += iData.country;
    }
    else {
      // These strings will be hidden in CSS anyhow
      host = "";
      owner = "";
    }

    // Push the appropriate strings out to the UI
    this._identityPopupContentHost.textContent = host;
    this._identityPopupContentOwner.textContent = owner;
    this._identityPopupContentSupp.textContent = supplemental;
    this._identityPopupContentVerif.textContent = verifier;
  },

  show: function ih_show() {
    this._identityPopup.hidden = false;
    this._identityPopup.top = BrowserUI.toolbarH;
    this._identityPopup.focus();

    // Update the popup strings
    this.setPopupMessages(this._identityBox.getAttribute("mode") || this.IDENTITY_MODE_UNKNOWN);

    window.addEventListener("blur", this, true);
  },

  hide: function ih_hide() {
    window.removeEventListener("blur", this, true);
    this._identityPopup.hidden = true;
  },

  /**
   * Click handler for the identity-box element in primary chrome.
   */
  handleIdentityButtonEvent: function(event) {
    event.stopPropagation();

    if ((event.type == "click" && event.button != 0) ||
        (event.type == "keypress" && event.charCode != KeyEvent.DOM_VK_SPACE &&
         event.keyCode != KeyEvent.DOM_VK_RETURN))
      return; // Left click, space or enter only

    if (this._identityPopup.hidden)
      this.show();
    else
      this.hide();
  },

  handleEvent: function(event) {
    // Watch for blur events so we can close the panel
    this.hide();
  }
};

var gIdentityHandler;

/**
 * Returns the singleton instance of the identity handler class.  Should always be
 * used instead of referencing the global variable directly or creating new instances
 */
function getIdentityHandler() {
  if (!gIdentityHandler)
    gIdentityHandler = new IdentityHandler();
  return gIdentityHandler;
}


/**
 * Handler for blocked popups, triggered by DOMUpdatePageReport events in browser.xml
 */
const gPopupBlockerObserver = {
  _kIPM: Ci.nsIPermissionManager,

  onUpdatePageReport: function (aEvent)
  {
    var cBrowser = Browser.selectedBrowser;
    if (aEvent.originalTarget != cBrowser)
      return;

    if (!cBrowser.pageReport)
      return;

    // Only show the notification again if we've not already shown it. Since
    // notifications are per-browser, we don't need to worry about re-adding
    // it.
    if (!cBrowser.pageReport.reported) {
      if(gPrefService.getBoolPref("privacy.popups.showBrowserMessage")) {
        var bundle_browser = document.getElementById("bundle_browser");
        var brandBundle = document.getElementById("bundle_brand");
        var brandShortName = brandBundle.getString("brandShortName");
        var message;
        var popupCount = cBrowser.pageReport.length;

        if (popupCount > 1)
          message = bundle_browser.getFormattedString("popupWarningMultiple", [brandShortName, popupCount]);
        else
          message = bundle_browser.getFormattedString("popupWarning", [brandShortName]);

        var notificationBox = Browser.getNotificationBox();
        var notification = notificationBox.getNotificationWithValue("popup-blocked");
        if (notification) {
          notification.label = message;
        }
        else {
          var buttons = [
            {
              label: bundle_browser.getString("popupButtonAlwaysAllow"),
              accessKey: bundle_browser.getString("popupButtonAlwaysAllow.accesskey"),
              callback: function() { gPopupBlockerObserver.toggleAllowPopupsForSite(); }
            },
            {
              label: bundle_browser.getString("popupButtonNeverWarn"),
              accessKey: bundle_browser.getString("popupButtonNeverWarn.accesskey"),
              callback: function() { gPopupBlockerObserver.dontShowMessage(); }
            }
          ];

          const priority = notificationBox.PRIORITY_WARNING_MEDIUM;
          notificationBox.appendNotification(message, "popup-blocked",
                                             "",
                                             priority, buttons);
        }
      }
      // Record the fact that we've reported this blocked popup, so we don't
      // show it again.
      cBrowser.pageReport.reported = true;
    }
  },

  toggleAllowPopupsForSite: function (aEvent)
  {
    var currentURI = Browser.selectedBrowser.webNavigation.currentURI;
    var pm = Cc["@mozilla.org/permissionmanager;1"].getService(this._kIPM);
    pm.add(currentURI, "popup", this._kIPM.ALLOW_ACTION);

    Browser.getNotificationBox().removeCurrentNotification();
  },

  dontShowMessage: function ()
  {
    var showMessage = gPrefService.getBoolPref("privacy.popups.showBrowserMessage");
    gPrefService.setBoolPref("privacy.popups.showBrowserMessage", !showMessage);
    Browser.getNotificationBox().removeCurrentNotification();
  }
};

const gXPInstallObserver = {
  observe: function (aSubject, aTopic, aData)
  {
    var brandBundle = document.getElementById("bundle_brand");
    var browserBundle = document.getElementById("bundle_browser");
    switch (aTopic) {
      case "xpinstall-install-blocked":
        var installInfo = aSubject.QueryInterface(Ci.nsIXPIInstallInfo);
        var host = installInfo.originatingURI.host;
        var brandShortName = brandBundle.getString("brandShortName");
        var notificationName, messageString, buttons;
        if (!gPrefService.getBoolPref("xpinstall.enabled")) {
          notificationName = "xpinstall-disabled"
          if (gPrefService.prefIsLocked("xpinstall.enabled")) {
            messageString = browserBundle.getString("xpinstallDisabledMessageLocked");
            buttons = [];
          }
          else {
            messageString = browserBundle.getFormattedString("xpinstallDisabledMessage",
                                                             [brandShortName, host]);
            buttons = [{
              label: browserBundle.getString("xpinstallDisabledButton"),
              accessKey: browserBundle.getString("xpinstallDisabledButton.accesskey"),
              popup: null,
              callback: function editPrefs() {
                gPrefService.setBoolPref("xpinstall.enabled", true);
                return false;
              }
            }];
          }
        }
        else {
          notificationName = "xpinstall"
          messageString = browserBundle.getFormattedString("xpinstallPromptWarning",
                                                           [brandShortName, host]);

          buttons = [{
            label: browserBundle.getString("xpinstallPromptAllowButton"),
            accessKey: browserBundle.getString("xpinstallPromptAllowButton.accesskey"),
            popup: null,
            callback: function() {
              // Kick off the xpinstall
              var mgr = Cc["@mozilla.org/xpinstall/install-manager;1"].createInstance(Ci.nsIXPInstallManager);
              mgr.initManagerWithInstallInfo(installInfo);
              return false;
            }
          }];
        }

        var nBox = Browser.getNotificationBox();
        if (!nBox.getNotificationWithValue(notificationName)) {
          const priority = nBox.PRIORITY_WARNING_MEDIUM;
          const iconURL = "chrome://mozapps/skin/update/update.png";
          nBox.appendNotification(messageString, notificationName, iconURL, priority, buttons);
        }
        break;
    }
  }
};

const gSessionHistoryObserver = {
  observe: function sho_observe(subject, topic, data) {
    if (topic != "browser:purge-session-history")
      return;

    let back = document.getElementById("cmd_back");
    back.setAttribute("disabled", "true");
    let forward = document.getElementById("cmd_forward");
    forward.setAttribute("disabled", "true");

    let urlbar = document.getElementById("urlbar-edit");
    if (urlbar) {
      // Clear undo history of the URL bar
      urlbar.editor.transactionManager.clear()
    }
  }
};

function getNotificationBox(aWindow) {
  return Browser.getNotificationBox();
}

function showDownloadsManager(aWindowContext, aID, aReason) {
  BrowserUI.show(UIMODE_PANEL);
  BrowserUI.switchPane("downloads-container");
  // TODO: select the download with aID
}

var AlertsHelper = {
  _timeoutID: -1,
  _listener: null,
  _cookie: "",
  _clickable: false,

  showAlertNotification: function ah_show(aImageURL, aTitle, aText, aTextClickable, aCookie, aListener) {
    this._clickable = aTextClickable || false;
    this._listener = aListener || null;
    this._cookie = aCookie || "";

    document.getElementById("alerts-image").setAttribute("src", aImageURL);
    document.getElementById("alerts-title").value = aTitle;
    document.getElementById("alerts-text").textContent = aText;

    let container = document.getElementById("alerts-container");
    container.hidden = false;

    let rect = container.getBoundingClientRect();
    container.top = window.innerHeight - (rect.height + 20);
    container.left = window.innerWidth - (rect.width + 20);

    let timeout = gPrefService.getIntPref("alerts.totalOpenTime");
    let self = this;
    this._timeoutID = setTimeout(function() { self._timeoutAlert(); }, timeout);
  },

  _timeoutAlert: function ah__timeoutAlert() {
    this._timeoutID = -1;
    let container = document.getElementById("alerts-container");
    container.hidden = true;

    if (this._listener)
      this._listener.observe(null, "alertfinished", this._cookie);

    // TODO: add slide to UI
  },

  click: function ah_click(aEvent) {
    if (this._clickable && this._listener)
      this._listener.observe(null, "alertclickcallback", this._cookie);

    if (this._timeoutID != -1) {
      clearTimeout(this._timeoutID);
      this._timeoutAlert();
    }
  }
}

var HelperAppDialog = {
  _launcher: null,

  show: function had_show(aLauncher) {
    this._launcher = aLauncher;
    document.getElementById("helperapp-target").value = this._launcher.suggestedFileName;

    let toolbar = document.getElementById("toolbar-main");
    let top = toolbar.top + toolbar.boxObject.height;
    let container = document.getElementById("helperapp-container");
    container.hidden = false;

    let rect = container.getBoundingClientRect();
    container.top = top < 0 ? 0 : top;
    container.left = (window.innerWidth - rect.width) / 2;
  },

  save: function had_save() {
    this._launcher.saveToDisk(null, false);
    this.close();
  },

  open: function had_open() {
    this._launcher.launchWithApplication(null, false);
    this.close();
  },

  close: function had_close() {
    document.getElementById("helperapp-target").value = "";
    let container = document.getElementById("helperapp-container");
    container.hidden = true;
  }
}

function ProgressController(tab) {
  this._tab = tab;
}

ProgressController.prototype = {
  get browser() {
    return this._tab.browser;
  },

  onStateChange: function(aWebProgress, aRequest, aStateFlags, aStatus) {
    // ignore notification that aren't about the main document (iframes, etc)
    if (aWebProgress.DOMWindow != this._tab.browser.contentWindow)
      return;

    if (aStateFlags & Ci.nsIWebProgressListener.STATE_IS_NETWORK) {
      if (aStateFlags & Ci.nsIWebProgressListener.STATE_START)
        this._networkStart();
      else if (aStateFlags & Ci.nsIWebProgressListener.STATE_STOP)
        this._networkStop();
    } else if (aStateFlags & Ci.nsIWebProgressListener.STATE_IS_DOCUMENT) {
      if (aStateFlags & Ci.nsIWebProgressListener.STATE_STOP)
        this._documentStop();
    }
  },

  // This method is called to indicate progress changes for the currently
  // loading page.
  onProgressChange: function(aWebProgress, aRequest, aCurSelf, aMaxSelf, aCurTotal, aMaxTotal) {
  },

  // This method is called to indicate a change to the current location.
  onLocationChange: function(aWebProgress, aRequest, aLocationURI) {
    // XXX this code is not multiple-tab friendly.
    var location = aLocationURI ? aLocationURI.spec : "";
    let selectedBrowser = Browser.selectedBrowser;
    let lastURI = selectedBrowser.lastURI;

    //don't do anything for about:blank or about:firstrun on first display
    if (!lastURI && (location == "about:blank" || location == "about:firstrun" ))
      return;

    this._hostChanged = true;

    // This code here does not compare uris exactly when determining
    // whether or not the message(s) should be hidden since the message
    // may be prematurely hidden when an install is invoked by a click
    // on a link that looks like this:
    //
    // <a href="#" onclick="return install();">Install Foo</a>
    //
    // - which fires a onLocationChange message to uri + '#'...
    selectedBrowser.lastURI = aLocationURI;
    if (lastURI) {
      var oldSpec = lastURI.spec;
      var oldIndexOfHash = oldSpec.indexOf("#");
      if (oldIndexOfHash != -1)
        oldSpec = oldSpec.substr(0, oldIndexOfHash);
      var newSpec = location;
      var newIndexOfHash = newSpec.indexOf("#");
      if (newIndexOfHash != -1)
        newSpec = newSpec.substr(0, newSpec.indexOf("#"));
      if (newSpec != oldSpec) {
        // Remove all the notifications, except for those which want to
        // persist across the first location change.

        // XXX
        // var nBox = Browser.getNotificationBox();
        // nBox.removeTransientNotifications();
      }
    }

    if (aWebProgress.DOMWindow == selectedBrowser.contentWindow) {
      BrowserUI.setURI();
    }
  },

  // This method is called to indicate a status changes for the currently
  // loading page.  The message is already formatted for display.
  onStatusChange: function(aWebProgress, aRequest, aStatus, aMessage) {
  },

  _networkStart: function() {
    this._tab.setLoading(true);

    if (Browser.selectedBrowser == this.browser) {
      Browser.canvasBrowser.startLoading();
      BrowserUI.update(TOOLBARSTATE_LOADING);

      // We increase the default text size to make the text more readable when
      // the page is zoomed out
      if (this.browser.markupDocumentViewer.textZoom != kDefaultTextZoom)
        this.browser.markupDocumentViewer.textZoom = kDefaultTextZoom;
    }
  },

  _networkStop: function() {
    this._tab.setLoading(false);

    if (Browser.selectedBrowser == this.browser) {
      Browser.canvasBrowser.endLoading();
      BrowserUI.update(TOOLBARSTATE_LOADED);
      this.browser.docShell.isOffScreenBrowser = true;
      if (Browser._isStartup) {
        // now we can set the viewport to a real size and draw the page
        ws.endUpdateBatch();
        Browser._selectedTab.updateThumbnail();
        Browser._isStartup = false;
      }
    }
    if (!this._isStartup)
      this._tab.updateThumbnail();
  },

  _documentStop: function() {
    // translate any phone numbers
    Browser.translatePhoneNumbers();

    if (Browser.selectedBrowser == this.browser) {
      // focus the dom window
      if (this.browser.currentURI.spec != "about:blank")
        this.browser.contentWindow.focus();
    }
  },

 // Properties used to cache security state used to update the UI
  _state: null,
  _host: undefined,
  _hostChanged: false, // onLocationChange will flip this bit

  // This method is called when the security state of the browser changes.
  onSecurityChange: function(aWebProgress, aRequest, aState) {
    // Don't need to do anything if the data we use to update the UI hasn't
    // changed
    if (this._state == aState && !this._hostChanged) {
      return;
    }
    this._state = aState;

    try {
      this._host = getBrowser().contentWindow.location.host;
    }
    catch(ex) {
      this._host = null;
    }

    this._hostChanged = false;

    // Don't pass in the actual location object, since it can cause us to
    // hold on to the window object too long.  Just pass in the fields we
    // care about. (bug 424829)
    var location = getBrowser().contentWindow.location;
    var locationObj = {};
    try {
      locationObj.host = location.host;
      locationObj.hostname = location.hostname;
      locationObj.port = location.port;
    }
    catch (ex) {
      // Can sometimes throw if the URL being visited has no host/hostname,
      // e.g. about:blank. The _state for these pages means we won't need these
      // properties anyways, though.
    }
    getIdentityHandler().checkIdentity(this._state, locationObj);
  },

  QueryInterface: function(aIID) {
    if (aIID.equals(Ci.nsIWebProgressListener) ||
        aIID.equals(Ci.nsISupportsWeakReference) ||
        aIID.equals(Ci.nsISupports))
      return this;

    throw Components.results.NS_ERROR_NO_INTERFACE;
  }
};


function Tab() {
}

Tab.prototype = {
  _id: null,
  _browser: null,
  _state: null,
  _listener: null,
  _loading: false,
  _chromeTab: null,

  get browser() {
    return this._browser;
  },

  get chromeTab() {
    return this._chromeTab;
  },

  isLoading: function() {
    return this._loading;
  },

  setLoading: function(b) {
    this._loading = b;
  },

  create: function(uri) {
    this._chromeTab = document.createElement("richlistitem");
    this._chromeTab.setAttribute("type", "documenttab");
    document.getElementById("tabs").addTab(this._chromeTab);

    this._createBrowser(uri);
  },

  destroy: function() {
    this._destroyBrowser();
    document.getElementById("tabs").removeTab(this._chromeTab);
    this._chromeTab = null;
  },

  _createBrowser: function(uri) {
    if (this._browser)
      throw "Browser already exists";

    // Create the browser using the current width the dynamically size the height
    let scaledHeight = kDefaultBrowserWidth * (window.innerHeight / window.innerWidth);
    let browser = this._browser = document.createElement("browser");
    browser.setAttribute("style", "overflow: hidden; visibility: hidden; width: " + kDefaultBrowserWidth + "px; height: " + scaledHeight + "px;");
    browser.setAttribute("type", "content");
    browser.setAttribute("src", uri);

    // Attach the popup contextmenu    
    let canvas = document.getElementById("browser-canvas");
    browser.setAttribute("contextmenu", canvas.getAttribute("contextmenu"));
    let autocompletepopup = canvas.getAttribute("autocompletepopup");
    if (autocompletepopup)
      browser.setAttribute("autocompletepopup", autocompletepopup);

    // Append the browser to the document, which should start the page load
    document.getElementById("browsers").appendChild(browser);

    // Attach a separate progress listener to the browser
    this._listener = new ProgressController(this);
    browser.addProgressListener(this._listener);
  },

  _destroyBrowser: function() {
    document.getElementById("browsers").removeChild(this._browser);
    this._browser = null;
  },

  saveState: function() {
    let state = { };

    this._url = browser.contentWindow.location.toString();
    var browser = this.getBrowserForDisplay(display);
    var doc = browser.contentDocument;
    if (doc instanceof HTMLDocument) {
      var tags = ["input", "textarea", "select"];

      for (var t = 0; t < tags.length; t++) {
        var elements = doc.getElementsByTagName(tags[t]);
        for (var e = 0; e < elements.length; e++) {
          var element = elements[e];
          var id;
          if (element.id)
            id = "#" + element.id;
          else if (element.name)
            id = "$" + element.name;

          if (id)
            state[id] = element.value;
        }
      }
    }

    state._scrollX = browser.contentWindow.scrollX;
    state._scrollY = browser.contentWindow.scrollY;

    this._state = state;
  },

  restoreState: function() {
    let state = this._state;
    if (!state)
      return;

    let doc = this._browser.contentDocument;
    for (item in state) {
      var elem = null;
      if (item.charAt(0) == "#") {
        elem = doc.getElementById(item.substring(1));
      }
      else if (item.charAt(0) == "$") {
        var list = doc.getElementsByName(item.substring(1));
        if (list.length)
          elem = list[0];
      }

      if (elem)
        elem.value = state[item];
    }

    this._browser.contentWindow.scrollTo(state._scrollX, state._scrollY);
  },

  updateThumbnail: function() {
    if (!this._browser)
      return;

    let srcCanvas = (Browser.selectedBrowser == this._browser) ? document.getElementById("browser-canvas") : null;
    this._chromeTab.updateThumbnail(this._browser, srcCanvas);
  }
}
