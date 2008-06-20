/* -*- Mode: javascript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*-
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

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

var HUDBar = null;

function getBrowser() {
  return Browser.content.browser;
}

var Browser = {
  _content : null,

  _titleChanged : function(aEvent) {
    if (aEvent.target != this.content.browser.contentDocument)
      return;

    document.title = "Fennec - " + aEvent.target.title;
  },

  _tabOpen : function(aEvent) {
    aEvent.originalTarget.zoomController = new ZoomController(this._content);
    aEvent.originalTarget.mouseController = new MouseController(this._content);
    aEvent.originalTarget.progressController = new ProgressController(aEvent.originalTarget);
  },

  _tabClose : function(aEvent) {
  },

  _tabSelect : function(aEvent) {
    //LocationBar.update(TOOLBARSTATE_INDETERMINATE);
  },

  _popupShowing : function(aEvent) {
    var target = document.popupNode;
    var isContentSelected = !document.commandDispatcher.focusedWindow.getSelection().isCollapsed;
    var isTextField = target instanceof HTMLTextAreaElement;
    if (target instanceof HTMLInputElement && (target.type == "text" || target.type == "password"))
      isTextField = true;
    var isTextSelected= (isTextField && target.selectionStart != target.selectionEnd);

    /* not ready
    var cut = document.getElementById("menuitem_cut");
    var copy = document.getElementById("menuitem_copy");
    var paste = document.getElementById("menuitem_paste");
    var del = document.getElementById("menuitem_delete");

    cut.hidden = ((!isTextField || !isTextSelected) ? true : false);
    copy.hidden = (((!isTextField || !isTextSelected) && !isContentSelected) ? true : false);
    paste.hidden = (!isTextField ? true : false);
    del.hidden = (!isTextField ? true : false);

    var copylink = document.getElementById("menuitem_copylink");
    var copylinkSep = document.getElementById("menusep_copylink");
    if (target instanceof HTMLAnchorElement && target.href) {
      copylink.hidden = false;
      copylinkSep.hidden = false;
    }
    else {
      copylink.hidden = true;
      copylinkSep.hidden = true;
    }
    */
    InlineSpellCheckerUI.clearSuggestionsFromMenu();
    InlineSpellCheckerUI.uninit();

    var separator = document.getElementById("menusep_spellcheck");
    separator.hidden = true;
    var addToDictionary = document.getElementById("menuitem_addToDictionary");
    addToDictionary.hidden = true;
    var noSuggestions = document.getElementById("menuitem_noSuggestions");
    noSuggestions.hidden = true;

    // if the document is editable, show context menu like in text inputs
    var win = target.ownerDocument.defaultView;
    if (win) {
      var isEditable = false;
      try {
        var editingSession = win.QueryInterface(Ci.nsIInterfaceRequestor)
                                .getInterface(Ci.nsIWebNavigation)
                                .QueryInterface(Ci.nsIInterfaceRequestor)
                                .getInterface(Ci.nsIEditingSession);
        isEditable = editingSession.windowIsEditable(win);
      }
      catch(ex) {
        // If someone built with composer disabled, we can't get an editing session.
      }
    }

    var editor = null;
    if (isTextField && !target.readOnly)
      editor = target.QueryInterface(Ci.nsIDOMNSEditableElement).editor;

    if (isEditable)
      editor = editingSession.getEditorForWindow(win);
dump("ready\n");
    if (editor) {
dump("editor\n");
dump("anchor="+editor.selection.anchorNode+"\n");
dump("offset="+editor.selection.anchorOffset+"\n");
dump(editor.selectionController.getSelection(Ci.nsISelectionController.SELECTION_SPELLCHECK).rangeCount);
      InlineSpellCheckerUI.init(editor);
dump(InlineSpellCheckerUI.canSpellCheck);
//      InlineSpellCheckerUI.initFromEvent(document.popupRangeParent, document.popupRangeOffset);
      InlineSpellCheckerUI.initFromEvent(editor.selection.anchorNode, editor.selection.anchorOffset);

      var onMisspelling = InlineSpellCheckerUI.overMisspelling;
      if (onMisspelling) {
dump("misspelling\n");
        separator.hidden = false;
        addToDictionary.hidden = false;
        var menu = document.getElementById("popup_content");
        var suggestions = InlineSpellCheckerUI.addSuggestionsToMenu(menu, addToDictionary, 5);
        noSuggestions.hidden = (suggestions > 0);
      }
    }
  },

  startup : function() {
    this.prefs = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefBranch2);

    window.controllers.appendController(this);
    if (LocationBar)
      window.controllers.appendController(LocationBar);
    if (HUDBar)
      window.controllers.appendController(HUDBar);

    var ios = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
    var styleSheets = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);

    // Should we hide the cursors
    var hideCursor = this.prefs.getBoolPref("browser.ui.cursor") == false;
    if (hideCursor) {
      window.QueryInterface(Ci.nsIDOMChromeWindow).setCursor("none");

      var styleURI = ios.newURI("chrome://browser/content/content.css", null, null);
      styleSheets.loadAndRegisterSheet(styleURI, styleSheets.AGENT_SHEET);
    }

    // load styles for scrollbars
    var styleURI = ios.newURI("chrome://browser/content/scrollbars.css", null, null);
    styleSheets.loadAndRegisterSheet(styleURI, styleSheets.AGENT_SHEET);

    this._content = document.getElementById("content");
    this._content.addEventListener("DOMTitleChanged", this, true);
    this._content.addEventListener("TabOpen", this, true);
    this._content.addEventListener("TabClose", this, true);
    this._content.addEventListener("TabSelect", this, true);
    document.getElementById("popup_content").addEventListener("popupshowing", this, false);

    this._content.addBrowser("about:blank", null, null, false);

    if (LocationBar)
      LocationBar.init();
    if (HUDBar)
      HUDBar.init();
    DownloadMonitor.init();
    Cc["@mozilla.org/login-manager;1"].getService(Ci.nsILoginManager);

    // Determine the initial launch page
    var whereURI = null;
    try {
      // Use a homepage
      whereURI = this.prefs.getCharPref("browser.startup.homepage");
    }
    catch (e) {
    }

    // Use a commandline parameter
    if (window.arguments && window.arguments[0]) {
      try {
        var cmdLine = window.arguments[0].QueryInterface(Ci.nsICommandLine);
        if (cmdLine.length == 1) {
          var uri = cmdLine.getArgument(0);
          if (uri != "" && uri[0] != '-') {
            whereURI = cmdLine.resolveURI(uri);
            if (whereURI)
              whereURI = whereURI.spec;
          }
        }
      }
      catch (e) {
      }
    }

    if (whereURI) {
      var self = this;
      setTimeout(function() { self.content.browser.loadURI(whereURI, null, null, false); }, 10);
    }
  },

  get content() {
    return this._content;
  },

  handleEvent: function (aEvent) {
    switch (aEvent.type) {
      case "DOMTitleChanged":
        this._titleChanged(aEvent);
        break;
      case "TabOpen":
        this._tabOpen(aEvent);
        break;
      case "TabClose":
        this._tabClose(aEvent);
        break;
      case "TabSelect":
        this._tabSelect(aEvent);
        break;
      case "popupshowing":
        this._popupShowing(aEvent);
        break;
    }
  },

  supportsCommand : function(cmd) {
    var isSupported = false;
    switch (cmd) {
      case "cmd_newTab":
      case "cmd_closeTab":
      case "cmd_switchTab":
      case "cmd_menu":
      case "cmd_fullscreen":
      case "cmd_addons":
      case "cmd_downloads":
        isSupported = true;
        break;
      default:
        isSupported = false;
        break;
    }
    return isSupported;
  },

  isCommandEnabled : function(cmd) {
    return true;
  },

  doCommand : function(cmd) {
    var browser = this.content.browser;

    switch (cmd) {
      case "cmd_newTab":
        this.content.addBrowser("about:blank", null, null, false);
        break;
      case "cmd_closeTab":
        this.content.removeBrowser();
        break;
      case "cmd_switchTab":
        this.content.select();
        break;
      case "cmd_menu":
      {
//        var fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
//        fp.init(window, "Pick a file", Ci.nsIFilePicker.modeOpen);
//        fp.appendFilters(Ci.nsIFilePicker.filterAll);
//        fp.show();

        var menu = document.getElementById("mainmenu");
        menu.openPopup(window.screenX, window.screenY, true);
        break;
      }
      case "cmd_fullscreen":
        window.fullScreen = window.fullScreen ? false : true;
        break;
      case "cmd_addons":
      {
        const EMTYPE = "Extension:Manager";

        var aOpenMode = "extensions";
        var wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);
        var needToOpen = true;
        var windowType = EMTYPE + "-" + aOpenMode;
        var windows = wm.getEnumerator(windowType);
        while (windows.hasMoreElements()) {
          var theEM = windows.getNext().QueryInterface(Ci.nsIDOMWindowInternal);
          if (theEM.document.documentElement.getAttribute("windowtype") == windowType) {
            theEM.focus();
            needToOpen = false;
            break;
          }
        }

        if (needToOpen) {
          const EMURL = "chrome://mozapps/content/extensions/extensions.xul?type=" + aOpenMode;
          const EMFEATURES = "chrome,dialog=no,resizable=yes";
          window.openDialog(EMURL, "", EMFEATURES);
        }
        break;
      }
      case "cmd_downloads":
        Cc["@mozilla.org/download-manager-ui;1"].getService(Ci.nsIDownloadManagerUI).show(window);
    }
  }
};


function ProgressController(aBrowser) {
  this.init(aBrowser);
}

ProgressController.prototype = {
  _browser : null,

  init : function(aBrowser) {
    this._browser = aBrowser;
    this._browser.addProgressListener(this, Components.interfaces.nsIWebProgress.NOTIFY_ALL);
  },

  onStateChange : function(aWebProgress, aRequest, aStateFlags, aStatus) {
    if (aStateFlags & Ci.nsIWebProgressListener.STATE_IS_NETWORK) {
      if (aRequest && aWebProgress.DOMWindow == this._browser.contentWindow) {
        if (aStateFlags & Ci.nsIWebProgressListener.STATE_START) {
          if (LocationBar)
            LocationBar.update(TOOLBARSTATE_LOADING);
          if (HUDBar)
            HUDBar.update(TOOLBARSTATE_LOADING);
        }
        else if (aStateFlags & Ci.nsIWebProgressListener.STATE_STOP) {
          this._browser.zoomController.scale = 1;
          if (LocationBar)
            LocationBar.update(TOOLBARSTATE_LOADED);
          if (HUDBar)
            HUDBar.update(TOOLBARSTATE_LOADED);
        }
      }
    }

    if (aStateFlags & Ci.nsIWebProgressListener.STATE_IS_DOCUMENT) {
      if (aStateFlags & Ci.nsIWebProgressListener.STATE_STOP) {
        aWebProgress.DOMWindow.focus();
        //aWebProgress.DOMWindow.scrollbars.visible = false;
      }
    }
  },

  // This method is called to indicate progress changes for the currently
  // loading page.
  onProgressChange : function(aWebProgress, aRequest, aCurSelf, aMaxSelf, aCurTotal, aMaxTotal) {
  },

  // This method is called to indicate a change to the current location.
  onLocationChange : function(aWebProgress, aRequest, aLocation) {
    
    this._hostChanged = true;
    
    if (aWebProgress.DOMWindow == this._browser.contentWindow) {
      if (LocationBar)
        LocationBar.setURI();
      if (HUDBar)
        HUDBar.setURI(aLocation.spec);
    }
  },

  // This method is called to indicate a status changes for the currently
  // loading page.  The message is already formatted for display.
  onStatusChange : function(aWebProgress, aRequest, aStatus, aMessage) {
  },

 // Properties used to cache security state used to update the UI
  _state: null,
  _host: undefined,
  _hostChanged: false, // onLocationChange will flip this bit

  // This method is called when the security state of the browser changes.
  onSecurityChange : function(aWebProgress, aRequest, aState) {

    // Don't need to do anything if the data we use to update the UI hasn't
    // changed
    if (this._state == aState &&
        !this._hostChanged) {
      return;
    }
    this._state = aState;

    try {
      this._host = getBrowser().contentWindow.location.host;
    } catch(ex) {
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
    } catch (ex) {
      // Can sometimes throw if the URL being visited has no host/hostname,
      // e.g. about:blank. The _state for these pages means we won't need these
      // properties anyways, though.
    }
    getIdentityHandler().checkIdentity(this._state, locationObj);
    
  },

  QueryInterface : function(aIID) {
    if (aIID.equals(Components.interfaces.nsIWebProgressListener) ||
        aIID.equals(Components.interfaces.nsISupportsWeakReference) ||
        aIID.equals(Components.interfaces.nsISupports))
      return this;

    throw Components.results.NS_ERROR_NO_INTERFACE;
  }
};
/*
window.addEventListener("keydown", fskey, true);

function fskey(aEvent) {
  alert(aEvent.keyCode);
  if (117 == aEvent.keyCode) {
  }
}
*/
var SpeedCache = function(maxsize) {
    this.init(maxsize);
}

SpeedCache.prototype = {
  _items   : null,
  _maxsize : 1,
  
  init: function(maxsize) {
    
    if (maxsize <= 0) maxsize = 1;
    this._items = new Array(maxsize);
    this.clear();
  },

  clear: function() {
    var maxsize = this._items.length;
    this._count = 0;
    for (var x = 0; x < maxsize; x++)
	    this._items[x] = 0;
  },

  addSpeed: function(speed){
    var index = this._count % this._items.length;
    this._items[index] = speed;
    this._count++;
  },
  
  getAverage: function() {
    var maxsize = this._items.length;
    var sum = 0;
    for (x = 0; x < maxsize; x++) {
	    sum += this._items[x];
    }
    return sum / maxsize;
  },
}

var MouseController = function(browser) {
  this.init(browser);
}

MouseController.prototype = {
  _browser: null,
  _contextID : null,
  _mousedown : false,
  _panning : false,
  // just remember the last 5 events.
  _lastX   : new SpeedCache(5),
  _lastY   : new SpeedCache(5),

  init: function(aBrowser)
  {
    this._browser = aBrowser;
    this._browser.addEventListener("mousedown", this, false);
    this._browser.addEventListener("mouseup",this, false);
    this._browser.addEventListener("mousemove", this, false);
  },

  handleEvent: function(aEvent)
  {
    if (!aEvent.type in this)
      dump("MouseController called with unknown event type " + aEvent.type + "\n");
    this[aEvent.type](aEvent);
  },

  mousedown: function(aEvent)
  {
    // Start timer for tap-n-hold context menu
    /*
    var self = this;
    this._contextID = setTimeout(function() { self.contextMenu(aEvent); }, 750);
    */

    if (aEvent.target instanceof HTMLInputElement ||
        aEvent.target instanceof HTMLTextAreaElement ||
        aEvent.target instanceof HTMLAnchorElement ||
        aEvent.target instanceof HTMLSelectElement)
      return;

    // Check to see if we should treat this as a double-click
    if (this.firstEvent &&
        (aEvent.timeStamp - this.firstEvent.timeStamp) < 400 &&
        Math.abs(aEvent.screenX - this.firstEvent.screenX) < 30 &&
        Math.abs(aEvent.screenY - this.firstEvent.screenY) < 30) {
      this.dblclick(aEvent);
      return;
    }

    this.lastEvent = this.firstEvent = aEvent;
    this._lastX.clear();
    this._lastY.clear();
    this._mousedown = true;
    this._panning = false;

    //FIX Show scrollbars now

    aEvent.stopPropagation();
    aEvent.preventDefault();
  },

  mouseup: function(aEvent)
  {
    this._mousedown = false;
    if (this._contextID) {
      clearTimeout(this._contextID);
      this._contextID = null;
    }

    if (!this._panning)
      return;

    //FIX Hide scrollbars now

    // Cancel link clicks if we've been dragging for a while
    var totalDistance = Math.sqrt(
        Math.pow(this.firstEvent.screenX - aEvent.screenX, 2) +
        Math.pow(this.firstEvent.screenY - aEvent.screenY, 2));

    if (totalDistance < 10) { // why 10?  from mfinkle
      // and if we haven't been dragging for very long, just
      // end the pan without any kinetic scroll
      this._browser.endPan();
      this._panning = false;
      return;
    }

    aEvent.preventDefault();

    // Keep scrolling if there is enough momentum
    function _doKineticScroll(browser, speedX, speedY, step) {
      const decayFactor = 0.95;
      const cutoff = 2;

      // enforce a speed limit
      const speedLimit = 55;
      if (Math.abs(speedY) > speedLimit)
        speedY = speedY > 0 ? speedLimit : -speedLimit;

      if (Math.abs(speedX) > speedLimit)
        speedX = speedX > 0 ? speedLimit : -speedLimit;

      // We want these numbers to be whole and moving in the direction of zero.
      if (speedX < 0)
        speedX = Math.ceil(speedX);
      else
        speedX = Math.floor(speedX);

      if (speedY < 0)
        speedY = Math.ceil(speedY);
      else
        speedY = Math.floor(speedY);

      //dump("##panning: " + -1 * speedX + " " + -1 * speedY + "\n");
      browser.doPan(-speedX, -speedY);

      // slow down.
      speedX *= (decayFactor - step/50);
      speedY *= (decayFactor - step/50);

      // see if we should continue
      if (Math.abs(speedX) > cutoff || Math.abs(speedY) > cutoff)
        setTimeout( function() { _doKineticScroll(browser, speedX, speedY, ++step); }, 0);
      else
        browser.endPan();
    };

    var browser = this._browser;
    var speedX  = this._lastX.getAverage() * 100;
    var speedY  = this._lastY.getAverage() * 100;
    setTimeout(function() { _doKineticScroll(browser, speedX, speedY, 0); }, 0);
  },

  mousemove: function(aEvent)
  {
    if (!this._mousedown)
      return;

    var delta = aEvent.timeStamp - this.lastEvent.timeStamp;
    var x = aEvent.screenX - this.lastEvent.screenX;
    var y = aEvent.screenY - this.lastEvent.screenY;

    // To reduce gitters, return if the mousemove was a small delta (bug 433513)
    if (40 > delta || (2 > Math.abs(x) && 2 > Math.abs(y)))
      return;

    this._lastX.addSpeed(x / delta);
    this._lastY.addSpeed(y / delta);
    this.lastEvent = aEvent;

    //dump("##: " + delta + " [" + x + ", " + y + "]\n");
    if (this._contextID) {
      clearTimeout(this._contextID);
      this._contextID = null;
    }

    if (!this._panning) {
      this._panning = true;
      this._browser.startPan();
    }

    if (this._panning) {
      this._browser.doPan(-x, -y);
    }

    //FIX Adjust scrollbars now

    aEvent.stopPropagation();
    aEvent.preventDefault();
  },

  dblclick: function(aEvent)
  {
    // Find the target by walking the dom. We want to zoom in on the block elements
    var target = aEvent.target;
    aEvent.preventDefault();
    while (target && target.nodeName != "HTML") {
      var disp = window.getComputedStyle(target, "").getPropertyValue("display");
      if (!disp.match(/(inline)/g)) {
        this._browser.browser.zoomController.toggleZoom(target);
        break;
      }
      else {
        target = target.parentNode;
      }
    }
    aEvent.stopPropagation();
    aEvent.preventDefault();
  },

  contextMenu: function(aEvent)
  {
    if (HUDBar)
      HUDBar.show();
    if (this._contextID && this._browser.contextMenu) {
      document.popupNode = aEvent.target;
      var popup = document.getElementById(this._browser.contextMenu);
      popup.openPopup(this._browser, "", aEvent.clientX, aEvent.clientY, true, false);

      this._contextID = null;

      aEvent.stopPropagation();
      aEvent.preventDefault();
    }
  }
}


function ZoomController(aBrowser) {
  this._browser = aBrowser;
};

// ZoomControler sets browser zoom
ZoomController.prototype = {
  _minScale : 0.1,
  _maxScale : 3,
  _target : null,

  set scale(s)
  {
    var clamp = Math.min(this._maxScale, Math.max(this._minScale, s));
    clamp = Math.floor(clamp * 1000) / 1000;  // Round to 3 digits
    if (clamp == this._browser.browser.markupDocumentViewer.fullZoom)
      return;

    this._browser.browser.markupDocumentViewer.fullZoom = clamp;

    // If we've zoomed out of the viewport, scroll us back in
    var leftEdge = this._browser.browser.contentWindow.scrollX + this._browser.browser.contentWindow.document.documentElement.clientWidth;
    var scrollX = this._browser.browser.contentWindow.document.documentElement.scrollWidth - leftEdge;
    if (scrollX < 0)
      this._browser.browser.contentWindow.scrollBy(scrollX, 0);
  },

  get scale()
  {
    return this._browser.browser.markupDocumentViewer.fullZoom;
  },

  reset: function()
  {
    this._minScale = ZoomController.prototype._minScale;
    this._maxScale = ZoomController.prototype._maxScale;
  },

  fitContent: function()
  {
    this._target = null;
    try {
      var oldScale = this.scale;
      this.scale = 1;    // reset the scale to 1 forces document to preferred size
      var body = this._browser.contentWindow.document.body;
      var html = this._browser.contentWindow.document.documentElement;
      var newScale = this.scale;
      var finalWidth = html.clientWidth;
    }
    catch(e) {
      dump(e + "\n");
      return;
    }

    var prefScrollWidth = Math.max(html.scrollWidth, body.scrollWidth); // empirical hack, no idea why
    if (prefScrollWidth > (this._browser.boxObject.width - 10) )  {
      // body wider than window, scale id down
      // we substract 10 to compensate for 10 pixel browser left margin
      newScale = (this._browser.boxObject.width ) / prefScrollWidth;
      finalWidth = prefScrollWidth;
    }
    body.style.minWidth = body.style.maxWidth = (finalWidth -20) + "px";
    this._minScale = Math.max(this._minScale, newScale);
    this.scale = newScale;
  },

  getPagePosition: function (el)
  {
    var r = el.getBoundingClientRect();
    retVal = {
      width: r.right - r.left,
      height: r.bottom - r.top,
      x: r.left + this._browser.contentWindow.scrollX,
      y: r.top + this._browser.contentWindow.scrollY
    };
    return retVal;
  },

  getWindowRect: function()
  {
    return {
      x: this._browser.contentWindow.scrollX,
      y: this._browser.contentWindow.scrollY,
      width: this._browser.boxObject.width / this.scale,
      height: this._browser.boxObject.height / this.scale
    };
  },

  toggleZoom: function(el)
  {
    if (!el) return;

    if (this.scale == 1 || el != this._target) {
      this._browser.zoomIn(el);
      this._target = el;
    }
    else {
      this.scale = 1;
      this._target = null;
    }
  },

  zoomToElement: function(el)
  {
    var margin = 8;

    // First get the width of the element so we can scale to its width
    var elRect = this.getPagePosition(el);
    this.scale = (this._browser.boxObject.width) / (elRect.width + 2 * margin);

    // Now that we are scaled, we need to scroll to the element
    elRect = this.getPagePosition(el);
    winRect = this.getWindowRect();
    this._browser.contentWindow.scrollTo(Math.max(elRect.x - margin, 0), Math.max(0, elRect.y - margin));
  }
};

/**
 * Utility class to handle manipulations of the identity indicators in the UI
 */
function IdentityHandler() {
  this._stringBundle = document.getElementById("bundle_browser");
  this._staticStrings = {};
  this._staticStrings[this.IDENTITY_MODE_DOMAIN_VERIFIED] = {
    encryption_label: this._stringBundle.getString("identity.encrypted")  
  };
  this._staticStrings[this.IDENTITY_MODE_IDENTIFIED] = {
    encryption_label: this._stringBundle.getString("identity.encrypted")
  };
  this._staticStrings[this.IDENTITY_MODE_UNKNOWN] = {
    encryption_label: this._stringBundle.getString("identity.unencrypted")  
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
  _cacheElements : function() {
    this._identityPopup = document.getElementById("identity-popup");
    this._identityBox = document.getElementById("identity-box");
    this._identityPopupContentBox = document.getElementById("identity-popup-content-box");
    this._identityPopupContentHost = document.getElementById("identity-popup-content-host");
    this._identityPopupContentOwner = document.getElementById("identity-popup-content-owner");
    this._identityPopupContentSupp = document.getElementById("identity-popup-content-supplemental");
    this._identityPopupContentVerif = document.getElementById("identity-popup-content-verifier");
    this._identityPopupEncLabel = document.getElementById("identity-popup-encryption-label");
  },

  /**
   * Handler for mouseclicks on the "More Information" button in the
   * "identity-popup" panel.
   */
  handleMoreInfoClick : function(event) {
    displaySecurityInfo();
    event.stopPropagation();
  },
  
  /**
   * Helper to parse out the important parts of _lastStatus (of the SSL cert in
   * particular) for use in constructing identity UI strings
  */
  getIdentityData : function() {
    var result = {};
    var status = this._lastStatus.QueryInterface(Components.interfaces.nsISSLStatus);
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
  checkIdentity : function(state, location) {
    var currentStatus = getBrowser().securityUI
                                .QueryInterface(Components.interfaces.nsISSLStatusProvider)
                                .SSLStatus;
    this._lastStatus = currentStatus;
    this._lastLocation = location;
    
    if (state & Components.interfaces.nsIWebProgressListener.STATE_IDENTITY_EV_TOPLEVEL)
      this.setMode(this.IDENTITY_MODE_IDENTIFIED);
    else if (state & Components.interfaces.nsIWebProgressListener.STATE_SECURE_HIGH)
      this.setMode(this.IDENTITY_MODE_DOMAIN_VERIFIED);
    else
      this.setMode(this.IDENTITY_MODE_UNKNOWN);
  },
  
  /**
   * Return the eTLD+1 version of the current hostname
   */
  getEffectiveHost : function() {
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
  setMode : function(newMode) {
    if (!this._identityBox) {
      // No identity box means the identity box is not visible, in which
      // case there's nothing to do.
      return;
    }

    this._identityBox.className = newMode;
    this.setIdentityMessages(newMode);
    
    // Update the popup too, if it's open
    if (this._identityPopup.state == "open")
      this.setPopupMessages(newMode);
  },
  
  /**
   * Set up the messages for the primary identity UI based on the specified mode,
   * and the details of the SSL cert, where applicable
   *
   * @param newMode The newly set identity mode.  Should be one of the IDENTITY_MODE_* constants.
   */
  setIdentityMessages : function(newMode) {
    if (newMode == this.IDENTITY_MODE_DOMAIN_VERIFIED) {
      var iData = this.getIdentityData();

      // We need a port number for all lookups.  If one hasn't been specified, use
      // the https default
      var lookupHost = this._lastLocation.host;
      if (lookupHost.indexOf(':') < 0)
        lookupHost += ":443";

      // Cache the override service the first time we need to check it
      if (!this._overrideService)
        this._overrideService = Components.classes["@mozilla.org/security/certoverride;1"]
                                          .getService(Components.interfaces.nsICertOverrideService);

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
  setPopupMessages : function(newMode) {
      
    this._identityPopup.className = newMode;
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

  hideIdentityPopup : function() {
    this._identityPopup.hidePopup();
  },

  /**
   * Click handler for the identity-box element in primary chrome.  
   */
  handleIdentityButtonEvent : function(event) {
  
    event.stopPropagation();
 
    if ((event.type == "click" && event.button != 0) ||
        (event.type == "keypress" && event.charCode != KeyEvent.DOM_VK_SPACE &&
         event.keyCode != KeyEvent.DOM_VK_RETURN))
      return; // Left click, space or enter only

    // Make sure that the display:none style we set in xul is removed now that
    // the popup is actually needed
    this._identityPopup.hidden = false;
    
    // Tell the popup to consume dismiss clicks, to avoid bug 395314
    this._identityPopup.popupBoxObject
        .setConsumeRollupEvent(Ci.nsIPopupBoxObject.ROLLUP_CONSUME);
    
    // Update the popup strings
    this.setPopupMessages(this._identityBox.className);
    
    // Now open the popup, anchored off the primary chrome element
    this._identityPopup.openPopup(this._identityBox, 'after_start');
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
