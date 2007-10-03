# -*- Mode: Java; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*-
# ***** BEGIN LICENSE BLOCK *****
# Version: MPL 1.1/GPL 2.0/LGPL 2.1
#
# The contents of this file are subject to the Mozilla Public License Version
# 1.1 (the "License"); you may not use this file except in compliance with
# the License. You may obtain a copy of the License at
# http://www.mozilla.org/MPL/
#
# Software distributed under the License is distributed on an "AS IS" basis,
# WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
# for the specific language governing rights and limitations under the
# License.
#
# The Original Code is the Firefox Sanitizer.
#
# The Initial Developer of the Original Code is
# Ben Goodger.
# Portions created by the Initial Developer are Copyright (C) 2005
# the Initial Developer. All Rights Reserved.
#
# Contributor(s):
#   Ben Goodger <ben@mozilla.org>
#   Giorgio Maone <g.maone@informaction.com>
#
# Alternatively, the contents of this file may be used under the terms of
# either the GNU General Public License Version 2 or later (the "GPL"), or
# the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
# in which case the provisions of the GPL or the LGPL are applicable instead
# of those above. If you wish to allow use of your version of this file only
# under the terms of either the GPL or the LGPL, and not to allow others to
# use your version of this file under the terms of the MPL, indicate your
# decision by deleting the provisions above and replace them with the notice
# and other provisions required by the GPL or the LGPL. If you do not delete
# the provisions above, a recipient may use your version of this file under
# the terms of any one of the MPL, the GPL or the LGPL.
#
# ***** END LICENSE BLOCK *****

function Sanitizer() {}
Sanitizer.prototype = {
  // warning to the caller: this one may raise an exception (e.g. bug #265028)
  clearItem: function (aItemName)
  {
    if (this.items[aItemName].canClear)
      this.items[aItemName].clear();
  },

  canClearItem: function (aItemName)
  {
    return this.items[aItemName].canClear;
  },
  
  _prefDomain: "privacy.item.",
  getNameFromPreference: function (aPreferenceName)
  {
    return aPreferenceName.substr(this._prefDomain.length);
  },
  
  /**
   * Deletes privacy sensitive data in a batch, according to user preferences
   *
   * @returns  null if everything's fine;  an object in the form
   *           { itemName: error, ... } on (partial) failure
   */
  sanitize: function ()
  {
    var psvc = Components.classes["@mozilla.org/preferences-service;1"]
                         .getService(Components.interfaces.nsIPrefService);
    var branch = psvc.getBranch(this._prefDomain);
    var errors = null;
    for (var itemName in this.items) {
      var item = this.items[itemName];
      if ("clear" in item && item.canClear && branch.getBoolPref(itemName)) {
        // Some of these clear() may raise exceptions (see bug #265028)
        // to sanitize as much as possible, we catch and store them, 
        // rather than fail fast.
        // Callers should check returned errors and give user feedback
        // about items that could not be sanitized
        try {
          item.clear();
        } catch(er) {
          if (!errors) 
            errors = {};
          errors[itemName] = er;
          dump("Error sanitizing " + itemName + ": " + er + "\n");
        }
      }
    }
    return errors;
  },
  
  items: {
    cache: {
      clear: function ()
      {
        const cc = Components.classes;
        const ci = Components.interfaces;
        var cacheService = cc["@mozilla.org/network/cache-service;1"]
                             .getService(ci.nsICacheService);
        try {
          cacheService.evictEntries(ci.nsICache.STORE_ANYWHERE);
        } catch(er) {}
      },
      
      get canClear()
      {
        return true;
      }
    },
    
    cookies: {
      clear: function ()
      {
        var cookieMgr = Components.classes["@mozilla.org/cookiemanager;1"]
                                  .getService(Components.interfaces.nsICookieManager);
        cookieMgr.removeAll();
      },
      
      get canClear()
      {
        return true;
      }
    },
    
    history: {
      clear: function ()
      {
        var globalHistory = Components.classes["@mozilla.org/browser/global-history;2"]
                                      .getService(Components.interfaces.nsIBrowserHistory);
        globalHistory.removeAllPages();
        
        try {
          var os = Components.classes["@mozilla.org/observer-service;1"]
                             .getService(Components.interfaces.nsIObserverService);
          os.notifyObservers(null, "browser:purge-session-history", "");
        }
        catch (e) { }
      },
      
      get canClear()
      {
        // bug 347231: Always allow clearing history due to dependencies on
        // the browser:purge-session-history notification. (like error console)
        return true;
      }
    },
    
    formdata: {
      clear: function ()
      {
        //Clear undo history of all searchBars
        var windowManager = Components.classes['@mozilla.org/appshell/window-mediator;1'].getService();
        var windowManagerInterface = windowManager.QueryInterface(Components.interfaces.nsIWindowMediator);
        var windows = windowManagerInterface.getEnumerator("navigator:browser");
        while (windows.hasMoreElements()) {
          var searchBar = windows.getNext().document.getElementById("searchbar");
          if (searchBar) {
            searchBar.value = "";
            searchBar.textbox.editor.transactionManager.clear();
          }
        }

        var formHistory = Components.classes["@mozilla.org/satchel/form-history;1"]
                                    .getService(Components.interfaces.nsIFormHistory2);
        formHistory.removeAllEntries();
      },
      
      get canClear()
      {
        var formHistory = Components.classes["@mozilla.org/satchel/form-history;1"]
                                    .getService(Components.interfaces.nsIFormHistory2);
        return formHistory.hasEntries;
      }
    },
    
    downloads: {
      clear: function ()
      {
        var dlMgr = Components.classes["@mozilla.org/download-manager;1"]
                              .getService(Components.interfaces.nsIDownloadManager);
        dlMgr.cleanUp();
      },

      get canClear()
      {
        var dlMgr = Components.classes["@mozilla.org/download-manager;1"]
                              .getService(Components.interfaces.nsIDownloadManager);
        return dlMgr.canCleanUp;
      }
    },
    
    passwords: {
      clear: function ()
      {
        var pwmgr = Components.classes["@mozilla.org/login-manager;1"]
                              .getService(Components.interfaces.nsILoginManager);
        pwmgr.removeAllLogins();
      },
      
      get canClear()
      {
        var pwmgr = Components.classes["@mozilla.org/login-manager;1"]
                              .getService(Components.interfaces.nsILoginManager);
        var logins = pwmgr.getAllLogins({});
        return (logins.length > 0);
      }
    },
    
    sessions: {
      clear: function ()
      {
        // clear all auth tokens
        var sdr = Components.classes["@mozilla.org/security/sdr;1"]
                            .getService(Components.interfaces.nsISecretDecoderRing);
        sdr.logoutAndTeardown();

        // clear plain HTTP auth sessions
        var authMgr = Components.classes['@mozilla.org/network/http-auth-manager;1']
                                .getService(Components.interfaces.nsIHttpAuthManager);
        authMgr.clearAll();
      },
      
      get canClear()
      {
        return true;
      }
    }
  }
};



// "Static" members
Sanitizer.prefDomain          = "privacy.sanitize.";
Sanitizer.prefPrompt          = "promptOnSanitize";
Sanitizer.prefShutdown        = "sanitizeOnShutdown";
Sanitizer.prefDidShutdown     = "didShutdownSanitize";

Sanitizer._prefs = null;
Sanitizer.__defineGetter__("prefs", function() 
{
  return Sanitizer._prefs ? Sanitizer._prefs
    : Sanitizer._prefs = Components.classes["@mozilla.org/preferences-service;1"]
                         .getService(Components.interfaces.nsIPrefService)
                         .getBranch(Sanitizer.prefDomain);
});

// Shows sanitization UI
Sanitizer.showUI = function(aParentWindow) 
{
  var ww = Components.classes["@mozilla.org/embedcomp/window-watcher;1"]
                     .getService(Components.interfaces.nsIWindowWatcher);
#ifdef XP_MACOSX
  ww.openWindow(null, // make this an app-modal window on Mac
#else
  ww.openWindow(aParentWindow,
#endif
                "chrome://browser/content/sanitize.xul",
                "Sanitize",
                "chrome,titlebar,centerscreen,modal",
                null);
};

/** 
 * Deletes privacy sensitive data in a batch, optionally showing the 
 * sanitize UI, according to user preferences
 *
 * @returns  null if everything's fine (no error or displayed UI,  which
 *           should handle errors);  
 *           an object in the form { itemName: error, ... } on (partial) failure
 */
Sanitizer.sanitize = function(aParentWindow) 
{
  if (Sanitizer.prefs.getBoolPref(Sanitizer.prefPrompt)) {
    Sanitizer.showUI(aParentWindow);
    return null;
  }
  return new Sanitizer().sanitize();
};

Sanitizer.onStartup = function() 
{
  // we check for unclean exit with pending sanitization
  Sanitizer._checkAndSanitize();
};

Sanitizer.onShutdown = function() 
{
  // we check if sanitization is needed and perform it
  Sanitizer._checkAndSanitize();
};

// this is called on startup and shutdown, to perform pending sanitizations
Sanitizer._checkAndSanitize = function() 
{
  const prefs = Sanitizer.prefs;
  if (prefs.getBoolPref(Sanitizer.prefShutdown) && 
      !prefs.prefHasUserValue(Sanitizer.prefDidShutdown)) {
    // this is a shutdown or a startup after an unclean exit
    Sanitizer.sanitize(null) || // sanitize() returns null on full success
      prefs.setBoolPref(Sanitizer.prefDidShutdown, true);
  }
};


