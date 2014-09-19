/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global Components, Services, dump */

"use strict";

const Cu = Components.utils;
const Cc = Components.classes;
const Ci = Components.interfaces;

this.EXPORTED_SYMBOLS = ["TrustedHostedAppsUtils"];

Cu.import("resource://gre/modules/Services.jsm");

#ifdef MOZ_WIDGET_ANDROID
// On Android, define the "debug" function as a binding of the "d" function
// from the AndroidLog module so it gets the "debug" priority and a log tag.
// We always report debug messages on Android because it's unnecessary
// to restrict reporting, per bug 1003469.
let debug = Cu
  .import("resource://gre/modules/AndroidLog.jsm", {})
  .AndroidLog.d.bind(null, "TrustedHostedAppsUtils");
#else
// Elsewhere, report debug messages only if dom.mozApps.debug is set to true.
// The pref is only checked once, on startup, so restart after changing it.
let debug = Services.prefs.getBoolPref("dom.mozApps.debug") ?
  aMsg => dump("-*- TrustedHostedAppsUtils.jsm : " + aMsg + "\n") :
  () => {};
#endif

/**
 * Verification functions for Trusted Hosted Apps.
 * (Manifest signature verification is in Webapps.jsm as part of
 * regular signature verification.)
 */
this.TrustedHostedAppsUtils = {

  /**
   * Check if the given host is pinned in the CA pinning database.
   */
  isHostPinned: function (aUrl) {
    let uri;
    try {
      uri = Services.io.newURI(aUrl, null, null);
    } catch(e) {
      debug("Host parsing failed: " + e);
      return false;
    }

    // TODO: use nsSiteSecurityService.isSecureURI()
    if (!uri.host || "https" != uri.scheme) {
      return false;
    }

    // Check certificate pinning
    let siteSecurityService;
    try {
      siteSecurityService = Cc["@mozilla.org/ssservice;1"]
        .getService(Ci.nsISiteSecurityService);
    } catch (e) {
      debug("nsISiteSecurityService error: " + e);
      // unrecoverable error, don't bug the user
      throw "CERTDB_ERROR";
    }

    if (siteSecurityService.isSecureHost(Ci.nsISiteSecurityService.HEADER_HPKP, uri.host, 0)) {
      debug("\tvalid certificate pinning for host: " + uri.host + "\n");
      return true;
    }

    debug("\tHost NOT pinned: " + uri.host + "\n");
    return false;
  },

  /**
   * Take a CSP policy string as input and ensure that it contains at
   * least the directives that are required ('script-src' and
   * 'style-src').  If the CSP policy string is 'undefined' or does
   * not contain some of the required csp directives the function will
   * return empty list with status set to false.  Otherwise a parsed
   * list of the unique sources listed from the required csp
   * directives is returned.
   */
  getCSPWhiteList: function(aCsp) {
    let isValid = false;
    let whiteList = [];
    let requiredDirectives = [ "script-src", "style-src" ];

    if (aCsp) {
      let validDirectives = [];
      let directives = aCsp.split(";");
      // TODO: Use nsIContentSecurityPolicy
      directives
        .map(aDirective => aDirective.trim().split(" "))
        .filter(aList => aList.length > 1)
        // we only restrict on requiredDirectives
        .filter(aList => (requiredDirectives.indexOf(aList[0]) != -1))
        .forEach(aList => {
          // aList[0] contains the directive name.
          // aList[1..n] contains sources.
          let directiveName = aList.shift()
          let sources = aList;

          if ((-1 == validDirectives.indexOf(directiveName))) {
            validDirectives.push(directiveName);
          }
          whiteList.push(...sources.filter(
             // 'self' is checked separately during manifest check
            aSource => (aSource !="'self'" && whiteList.indexOf(aSource) == -1)
          ));
        });

      // Check if all required directives are present.
      isValid = requiredDirectives.length === validDirectives.length;

      if (!isValid) {
        debug("White list doesn't contain all required directives!");
        whiteList = [];
      }
    }

    debug("White list contains " + whiteList.length + " hosts");
    return { list: whiteList, valid: isValid };
  },

  /**
   * Verify that the given csp is valid:
   *  1. contains required directives "script-src" and "style-src"
   *  2. required directives contain only "https" URLs
   *  3. domains of the restricted sources exist in the CA pinning database
   */
  verifyCSPWhiteList: function(aCsp) {
    let domainWhitelist = this.getCSPWhiteList(aCsp);
    if (!domainWhitelist.valid) {
      debug("TRUSTED_APPLICATION_WHITELIST_PARSING_FAILED");
      return false;
    }

    if (!domainWhitelist.list.every(aUrl => this.isHostPinned(aUrl))) {
      debug("TRUSTED_APPLICATION_WHITELIST_VALIDATION_FAILED");
      return false;
    }

    return true;
  }
};
