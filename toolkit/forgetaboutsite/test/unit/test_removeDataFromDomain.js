/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * vim: sw=2 ts=2 sts=2
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Test added with bug 460086 to test the behavior of the new API that was added
 * to remove all traces of visiting a site.
 */

////////////////////////////////////////////////////////////////////////////////
//// Globals

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/PlacesUtils.jsm");
Cu.import("resource://gre/modules/ForgetAboutSite.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "Promise",
                                  "resource://gre/modules/Promise.jsm");

const COOKIE_EXPIRY = Math.round(Date.now() / 1000) + 60;
const COOKIE_NAME = "testcookie";
const COOKIE_PATH = "/";

const LOGIN_USERNAME = "username";
const LOGIN_PASSWORD = "password";
const LOGIN_USERNAME_FIELD = "username_field";
const LOGIN_PASSWORD_FIELD = "password_field";

const PERMISSION_TYPE = "test-perm";
const PERMISSION_VALUE = Ci.nsIPermissionManager.ALLOW_ACTION;

const PREFERENCE_NAME = "test-pref";

////////////////////////////////////////////////////////////////////////////////
//// Utility Functions

/**
 * Creates an nsIURI object for the given string representation of a URI.
 *
 * @param aURIString
 *        The spec of the URI to create.
 * @returns an nsIURI representing aURIString.
 */
function uri(aURIString)
{
  return Cc["@mozilla.org/network/io-service;1"].
         getService(Ci.nsIIOService).
         newURI(aURIString, null, null);
}

/**
 * Asynchronously adds visits to a page.
 *
 * @param aPlaceInfo
 *        Can be an nsIURI, in such a case a single LINK visit will be added.
 *        Otherwise can be an object describing the visit to add, or an array
 *        of these objects:
 *          { uri: nsIURI of the page,
 *            transition: one of the TRANSITION_* from nsINavHistoryService,
 *            [optional] title: title of the page,
 *            [optional] visitDate: visit date in microseconds from the epoch
 *            [optional] referrer: nsIURI of the referrer for this visit
 *          }
 *
 * @return {Promise}
 * @resolves When all visits have been added successfully.
 * @rejects JavaScript exception.
 */
function promiseAddVisits(aPlaceInfo)
{
  let deferred = Promise.defer();
  let places = [];
  if (aPlaceInfo instanceof Ci.nsIURI) {
    places.push({ uri: aPlaceInfo });
  }
  else if (Array.isArray(aPlaceInfo)) {
    places = places.concat(aPlaceInfo);
  } else {
    places.push(aPlaceInfo)
  }

  // Create mozIVisitInfo for each entry.
  let now = Date.now();
  for (let i = 0; i < places.length; i++) {
    if (!places[i].title) {
      places[i].title = "test visit for " + places[i].uri.spec;
    }
    places[i].visits = [{
      transitionType: places[i].transition === undefined ? Ci.nsINavHistoryService.TRANSITION_LINK
                                                         : places[i].transition,
      visitDate: places[i].visitDate || (now++) * 1000,
      referrerURI: places[i].referrer
    }];
  }

  PlacesUtils.asyncHistory.updatePlaces(
    places,
    {
      handleError: function handleError(aResultCode, aPlaceInfo) {
        let ex = new Components.Exception("Unexpected error in adding visits.",
                                          aResultCode);
        deferred.reject(ex);
      },
      handleResult: function () {},
      handleCompletion: function handleCompletion() {
        deferred.resolve();
      }
    }
  );

  return deferred.promise;
}


/**
 * Asynchronously check a url is visited.
 *
 * @param aURI
 *        The URI.
 *
 * @return {Promise}
 * @resolves When the check has been added successfully.
 * @rejects JavaScript exception.
 */
function promiseIsURIVisited(aURI)
{
  let deferred = Promise.defer();
  PlacesUtils.asyncHistory.isURIVisited(aURI, function(aURI, aIsVisited) {
    deferred.resolve(aIsVisited);
  });

  return deferred.promise;
}

/**
 * Add a cookie to the cookie service.
 *
 * @param aDomain
 */
function add_cookie(aDomain)
{
  check_cookie_exists(aDomain, false);
  let cm = Cc["@mozilla.org/cookiemanager;1"].getService(Ci.nsICookieManager2);
  cm.add(aDomain, COOKIE_PATH, COOKIE_NAME, "", false, false, false,
         COOKIE_EXPIRY);
  check_cookie_exists(aDomain, true);
}

/**
 * Checks to ensure that a cookie exists or not for a domain.
 *
 * @param aDomain
 *        The domain to check for the cookie.
 * @param aExists
 *        True if the cookie should exist, false otherwise.
 */
function check_cookie_exists(aDomain, aExists)
{
  let cm = Cc["@mozilla.org/cookiemanager;1"].getService(Ci.nsICookieManager2);
  let cookie = {
    host: aDomain,
    name: COOKIE_NAME,
    path: COOKIE_PATH
  }
  let checker = aExists ? do_check_true : do_check_false;
  checker(cm.cookieExists(cookie));
}

/**
 * Adds a download to download history.
 *
 * @param aURIString
 *        The string of the URI to add.
 * @param aIsActive
 *        If it should be set to an active state in the database.  This does not
 *        make it show up in the list of active downloads however!
 */
function add_download(aURIString, aIsActive)
{
  function makeGUID() {
    let guid = "";
    for (var i = 0; i < 12; i++)
      guid += Math.floor(Math.random() * 10);
    return guid;
  }

  check_downloaded(aURIString, false);
  let db = Cc["@mozilla.org/download-manager;1"].
           getService(Ci.nsIDownloadManager).
           DBConnection;
  let stmt = db.createStatement(
    "INSERT INTO moz_downloads (source, state, guid) " +
    "VALUES (:source, :state, :guid)"
  );
  stmt.params.source = aURIString;
  stmt.params.state = aIsActive ? Ci.nsIDownloadManager.DOWNLOAD_DOWNLOADING :
                                  Ci.nsIDownloadManager.DOWNLOAD_FINISHED;
  stmt.params.guid = makeGUID();
  try {
    stmt.execute();
  }
  finally {
    stmt.finalize();
  }
  check_downloaded(aURIString, true);
}

/**
 * Checks to ensure a URI string is in download history or not.
 *
 * @param aURIString
 *        The string of the URI to check.
 * @param aIsDownloaded
 *        True if the URI should be downloaded, false otherwise.
 */
function check_downloaded(aURIString, aIsDownloaded)
{
  let db = Cc["@mozilla.org/download-manager;1"].
           getService(Ci.nsIDownloadManager).
           DBConnection;
  let stmt = db.createStatement(
    "SELECT * " +
    "FROM moz_downloads " +
    "WHERE source = :source"
  );
  stmt.params.source = aURIString;

  let checker = aIsDownloaded ? do_check_true : do_check_false;
  try {
    checker(stmt.executeStep());
  }
  finally {
    stmt.finalize();
  }
}

/**
 * Adds a disabled host to the login manager.
 *
 * @param aHost
 *        The host to add to the list of disabled hosts.
 */
function add_disabled_host(aHost)
{
  check_disabled_host(aHost, false);
  let lm = Cc["@mozilla.org/login-manager;1"].
           getService(Ci.nsILoginManager);
  lm.setLoginSavingEnabled(aHost, false);
  check_disabled_host(aHost, true);
}

/**
 * Checks to see if a host is disabled for storing logins or not.
 *
 * @param aHost
 *        The host to check if it is disabled.
 * @param aIsDisabled
 *        True if the host should be disabled, false otherwise.
 */
function check_disabled_host(aHost, aIsDisabled)
{
  let lm = Cc["@mozilla.org/login-manager;1"].
           getService(Ci.nsILoginManager);
  let checker = aIsDisabled ? do_check_false : do_check_true;
  checker(lm.getLoginSavingEnabled(aHost));
}

/**
 * Adds a login for the specified host to the login manager.
 *
 * @param aHost
 *        The host to add the login for.
 */
function add_login(aHost)
{
  check_login_exists(aHost, false);
  let login = Cc["@mozilla.org/login-manager/loginInfo;1"].
              createInstance(Ci.nsILoginInfo);
  login.init(aHost, "", null, LOGIN_USERNAME, LOGIN_PASSWORD,
             LOGIN_USERNAME_FIELD, LOGIN_PASSWORD_FIELD);
  let lm = Cc["@mozilla.org/login-manager;1"].
           getService(Ci.nsILoginManager);
  lm.addLogin(login);
  check_login_exists(aHost, true);
}

/**
 * Checks to see if a login exists for a host.
 *
 * @param aHost
 *        The host to check for the test login.
 * @param aExists
 *        True if the login should exist, false otherwise.
 */
function check_login_exists(aHost, aExists)
{
  let lm = Cc["@mozilla.org/login-manager;1"].
           getService(Ci.nsILoginManager);
  let count = { value: 0 };
  lm.findLogins(count, aHost, "", null);
  do_check_eq(count.value, aExists ? 1 : 0);
}

/**
 * Adds a permission for the specified URI to the permission manager.
 *
 * @param aURI
 *        The URI to add the test permission for.
 */
function add_permission(aURI)
{
  check_permission_exists(aURI, false);
  let pm = Cc["@mozilla.org/permissionmanager;1"].
           getService(Ci.nsIPermissionManager);
  let principal = Cc["@mozilla.org/scriptsecuritymanager;1"]
                    .getService(Ci.nsIScriptSecurityManager)
                    .getNoAppCodebasePrincipal(aURI);

  pm.addFromPrincipal(principal, PERMISSION_TYPE, PERMISSION_VALUE);
  check_permission_exists(aURI, true);
}

/**
 * Checks to see if a permission exists for the given URI.
 *
 * @param aURI
 *        The URI to check if a permission exists.
 * @param aExists
 *        True if the permission should exist, false otherwise.
 */
function check_permission_exists(aURI, aExists)
{
  let pm = Cc["@mozilla.org/permissionmanager;1"].
           getService(Ci.nsIPermissionManager);
  let principal = Cc["@mozilla.org/scriptsecuritymanager;1"]
                    .getService(Ci.nsIScriptSecurityManager)
                    .getNoAppCodebasePrincipal(aURI);

  let perm = pm.testExactPermissionFromPrincipal(principal, PERMISSION_TYPE);
  let checker = aExists ? do_check_eq : do_check_neq;
  checker(perm, PERMISSION_VALUE);
}

/**
 * Adds a content preference for the specified URI.
 *
 * @param aURI
 *        The URI to add a preference for.
 */
function add_preference(aURI)
{
  let deferred = Promise.defer();
  let cp = Cc["@mozilla.org/content-pref/service;1"].
             getService(Ci.nsIContentPrefService2);
  cp.set(aURI.spec, PREFERENCE_NAME, "foo", null, {
    handleCompletion: function() deferred.resolve()
  });
  return deferred.promise;
}

/**
 * Checks to see if a content preference exists for the given URI.
 *
 * @param aURI
 *        The URI to check if a preference exists.
 */
function preference_exists(aURI)
{
  let deferred = Promise.defer();
  let cp = Cc["@mozilla.org/content-pref/service;1"].
             getService(Ci.nsIContentPrefService2);
  let exists = false;
  cp.getByDomainAndName(aURI.spec, PREFERENCE_NAME, null, {
    handleResult: function() exists = true,
    handleCompletion: function() deferred.resolve(exists)
  });
  return deferred.promise;
}

////////////////////////////////////////////////////////////////////////////////
//// Test Functions

// History
function test_history_cleared_with_direct_match()
{
  const TEST_URI = uri("http://mozilla.org/foo");
  do_check_false(yield promiseIsURIVisited(TEST_URI));
  yield promiseAddVisits(TEST_URI);
  do_check_true(yield promiseIsURIVisited(TEST_URI));
  ForgetAboutSite.removeDataFromDomain("mozilla.org");
  do_check_false(yield promiseIsURIVisited(TEST_URI));
}

function test_history_cleared_with_subdomain()
{
  const TEST_URI = uri("http://www.mozilla.org/foo");
  do_check_false(yield promiseIsURIVisited(TEST_URI));
  yield promiseAddVisits(TEST_URI);
  do_check_true(yield promiseIsURIVisited(TEST_URI));
  ForgetAboutSite.removeDataFromDomain("mozilla.org");
  do_check_false(yield promiseIsURIVisited(TEST_URI));
}

function test_history_not_cleared_with_uri_contains_domain()
{
  const TEST_URI = uri("http://ilovemozilla.org/foo");
  do_check_false(yield promiseIsURIVisited(TEST_URI));
  yield promiseAddVisits(TEST_URI);
  do_check_true(yield promiseIsURIVisited(TEST_URI));
  ForgetAboutSite.removeDataFromDomain("mozilla.org");
  do_check_true(yield promiseIsURIVisited(TEST_URI));

  // Clear history since we left something there from this test.
  PlacesUtils.bhistory.removeAllPages();
}

// Cookie Service
function test_cookie_cleared_with_direct_match()
{
  const TEST_DOMAIN = "mozilla.org";
  add_cookie(TEST_DOMAIN);
  ForgetAboutSite.removeDataFromDomain("mozilla.org");
  check_cookie_exists(TEST_DOMAIN, false);
}

function test_cookie_cleared_with_subdomain()
{
  const TEST_DOMAIN = "www.mozilla.org";
  add_cookie(TEST_DOMAIN);
  ForgetAboutSite.removeDataFromDomain("mozilla.org");
  check_cookie_exists(TEST_DOMAIN, false);
}

function test_cookie_not_cleared_with_uri_contains_domain()
{
  const TEST_DOMAIN = "ilovemozilla.org";
  add_cookie(TEST_DOMAIN);
  ForgetAboutSite.removeDataFromDomain("mozilla.org");
  check_cookie_exists(TEST_DOMAIN, true);
}

// Download Manager
function test_download_history_cleared_with_direct_match()
{
  if (oldDownloadManagerDisabled()) {
    return;
  }

  const TEST_URI = "http://mozilla.org/foo";
  add_download(TEST_URI, false);
  ForgetAboutSite.removeDataFromDomain("mozilla.org");
  check_downloaded(TEST_URI, false);
}

function test_download_history_cleared_with_subdomain()
{
  if (oldDownloadManagerDisabled()) {
    return;
  }

  const TEST_URI = "http://www.mozilla.org/foo";
  add_download(TEST_URI, false);
  ForgetAboutSite.removeDataFromDomain("mozilla.org");
  check_downloaded(TEST_URI, false);
}

function test_download_history_not_cleared_with_active_direct_match()
{
  if (oldDownloadManagerDisabled()) {
    return;
  }

  // Tests that downloads marked as active in the db are not deleted from the db
  const TEST_URI = "http://mozilla.org/foo";
  add_download(TEST_URI, true);
  ForgetAboutSite.removeDataFromDomain("mozilla.org");
  check_downloaded(TEST_URI, true);

  // Reset state
  let db = Cc["@mozilla.org/download-manager;1"].
           getService(Ci.nsIDownloadManager).
           DBConnection;
  db.executeSimpleSQL("DELETE FROM moz_downloads");
  check_downloaded(TEST_URI, false);
}

// Login Manager
function test_login_manager_disabled_hosts_cleared_with_direct_match()
{
  const TEST_HOST = "http://mozilla.org";
  add_disabled_host(TEST_HOST);
  ForgetAboutSite.removeDataFromDomain("mozilla.org");
  check_disabled_host(TEST_HOST, false);
}

function test_login_manager_disabled_hosts_cleared_with_subdomain()
{
  const TEST_HOST = "http://www.mozilla.org";
  add_disabled_host(TEST_HOST);
  ForgetAboutSite.removeDataFromDomain("mozilla.org");
  check_disabled_host(TEST_HOST, false);
}

function test_login_manager_disabled_hosts_not_cleared_with_uri_contains_domain()
{
  const TEST_HOST = "http://ilovemozilla.org";
  add_disabled_host(TEST_HOST);
  ForgetAboutSite.removeDataFromDomain("mozilla.org");
  check_disabled_host(TEST_HOST, true);

  // Reset state
  let lm = Cc["@mozilla.org/login-manager;1"].
           getService(Ci.nsILoginManager);
  lm.setLoginSavingEnabled(TEST_HOST, true);
  check_disabled_host(TEST_HOST, false);
}

function test_login_manager_logins_cleared_with_direct_match()
{
  const TEST_HOST = "http://mozilla.org";
  add_login(TEST_HOST);
  ForgetAboutSite.removeDataFromDomain("mozilla.org");
  check_login_exists(TEST_HOST, false);
}

function test_login_manager_logins_cleared_with_subdomain()
{
  const TEST_HOST = "http://www.mozilla.org";
  add_login(TEST_HOST);
  ForgetAboutSite.removeDataFromDomain("mozilla.org");
  check_login_exists(TEST_HOST, false);
}

function tets_login_manager_logins_not_cleared_with_uri_contains_domain()
{
  const TEST_HOST = "http://ilovemozilla.org";
  add_login(TEST_HOST);
  ForgetAboutSite.removeDataFromDomain("mozilla.org");
  check_login_exists(TEST_HOST, true);

  let lm = Cc["@mozilla.org/login-manager;1"].
           getService(Ci.nsILoginManager);
  lm.removeAllLogins();
  check_login_exists(TEST_HOST, false);
}

// Permission Manager
function test_permission_manager_cleared_with_direct_match()
{
  const TEST_URI = uri("http://mozilla.org");
  add_permission(TEST_URI);
  ForgetAboutSite.removeDataFromDomain("mozilla.org");
  check_permission_exists(TEST_URI, false);
}

function test_permission_manager_cleared_with_subdomain()
{
  const TEST_URI = uri("http://www.mozilla.org");
  add_permission(TEST_URI);
  ForgetAboutSite.removeDataFromDomain("mozilla.org");
  check_permission_exists(TEST_URI, false);
}

function test_permission_manager_not_cleared_with_uri_contains_domain()
{
  const TEST_URI = uri("http://ilovemozilla.org");
  add_permission(TEST_URI);
  ForgetAboutSite.removeDataFromDomain("mozilla.org");
  check_permission_exists(TEST_URI, true);

  // Reset state
  let pm = Cc["@mozilla.org/permissionmanager;1"].
           getService(Ci.nsIPermissionManager);
  pm.removeAll();
  check_permission_exists(TEST_URI, false);
}

function waitForPurgeNotification() {
  let deferred = Promise.defer();

  let observer = {
    observe: function(aSubject, aTopic, aData)
    {
      Services.obs.removeObserver(observer, "browser:purge-domain-data");
      // test_storage_cleared needs this extra executeSoon because
      // the DOMStorage clean-up is also listening to this same observer
      // which is run synchronously.
      Services.tm.mainThread.dispatch(function() {
        deferred.resolve();
      }, Components.interfaces.nsIThread.DISPATCH_NORMAL);
    }
  };
  Services.obs.addObserver(observer, "browser:purge-domain-data", false);

  return deferred.promise;
}

// Content Preferences
function test_content_preferences_cleared_with_direct_match()
{
  const TEST_URI = uri("http://mozilla.org");
  do_check_false(yield preference_exists(TEST_URI));
  yield add_preference(TEST_URI);
  do_check_true(yield preference_exists(TEST_URI));
  ForgetAboutSite.removeDataFromDomain("mozilla.org");
  yield waitForPurgeNotification();
  do_check_false(yield preference_exists(TEST_URI));
}

function test_content_preferences_cleared_with_subdomain()
{
  const TEST_URI = uri("http://www.mozilla.org");
  do_check_false(yield preference_exists(TEST_URI));
  yield add_preference(TEST_URI);
  do_check_true(yield preference_exists(TEST_URI));
  ForgetAboutSite.removeDataFromDomain("mozilla.org");
  yield waitForPurgeNotification();
  do_check_false(yield preference_exists(TEST_URI));
}

function test_content_preferences_not_cleared_with_uri_contains_domain()
{
  const TEST_URI = uri("http://ilovemozilla.org");
  do_check_false(yield preference_exists(TEST_URI));
  yield add_preference(TEST_URI);
  do_check_true(yield preference_exists(TEST_URI));
  ForgetAboutSite.removeDataFromDomain("mozilla.org");
  yield waitForPurgeNotification();
  do_check_true(yield preference_exists(TEST_URI));

  // Reset state
  ForgetAboutSite.removeDataFromDomain("ilovemozilla.org");
  yield waitForPurgeNotification();
  do_check_false(yield preference_exists(TEST_URI));
}

// Cache
function test_cache_cleared()
{
  // Because this test is asynchronous, it should be the last test
  do_check_true(tests[tests.length - 1] == arguments.callee);

  // NOTE: We could be more extensive with this test and actually add an entry
  //       to the cache, and then make sure it is gone.  However, we trust that
  //       the API is well tested, and that when we get the observer
  //       notification, we have actually cleared the cache.
  // This seems to happen asynchronously...
  let os = Cc["@mozilla.org/observer-service;1"].
           getService(Ci.nsIObserverService);
  let observer = {
    observe: function(aSubject, aTopic, aData)
    {
      os.removeObserver(observer, "cacheservice:empty-cache");
      // Shutdown the download manager.
      Services.obs.notifyObservers(null, "quit-application", null);
      do_test_finished();
    }
  };
  os.addObserver(observer, "cacheservice:empty-cache", false);
  ForgetAboutSite.removeDataFromDomain("mozilla.org");
  do_test_pending();
}

function test_storage_cleared()
{
  function getStorageForURI(aURI)
  {
    let principal = Cc["@mozilla.org/scriptsecuritymanager;1"].
                    getService(Ci.nsIScriptSecurityManager).
                    getNoAppCodebasePrincipal(aURI);
    let dsm = Cc["@mozilla.org/dom/localStorage-manager;1"].
              getService(Ci.nsIDOMStorageManager);
    return dsm.createStorage(null, principal, "");
  }

  let s = [
    getStorageForURI(uri("http://mozilla.org")),
    getStorageForURI(uri("http://my.mozilla.org")),
    getStorageForURI(uri("http://ilovemozilla.org")),
  ];

  for (let i = 0; i < s.length; ++i) {
    let storage = s[i];
    storage.setItem("test", "value" + i);
    do_check_eq(storage.length, 1);
    do_check_eq(storage.key(0), "test");
    do_check_eq(storage.getItem("test"), "value" + i);
  }

  ForgetAboutSite.removeDataFromDomain("mozilla.org");
  yield waitForPurgeNotification();

  do_check_eq(s[0].getItem("test"), null);
  do_check_eq(s[0].length, 0);
  do_check_eq(s[1].getItem("test"), null);
  do_check_eq(s[1].length, 0);
  do_check_eq(s[2].getItem("test"), "value2");
  do_check_eq(s[2].length, 1);
}

let tests = [
  // History
  test_history_cleared_with_direct_match,
  test_history_cleared_with_subdomain,
  test_history_not_cleared_with_uri_contains_domain,

  // Cookie Service
  test_cookie_cleared_with_direct_match,
  test_cookie_cleared_with_subdomain,
  test_cookie_not_cleared_with_uri_contains_domain,

  // Download Manager
  // Note: active downloads tested in test_removeDataFromDomain_activeDownloads.js
  test_download_history_cleared_with_direct_match,
  test_download_history_cleared_with_subdomain,
  test_download_history_not_cleared_with_active_direct_match,

  // Login Manager
  test_login_manager_disabled_hosts_cleared_with_direct_match,
  test_login_manager_disabled_hosts_cleared_with_subdomain,
  test_login_manager_disabled_hosts_not_cleared_with_uri_contains_domain,
  test_login_manager_logins_cleared_with_direct_match,
  test_login_manager_logins_cleared_with_subdomain,
  tets_login_manager_logins_not_cleared_with_uri_contains_domain,

  // Permission Manager
  test_permission_manager_cleared_with_direct_match,
  test_permission_manager_cleared_with_subdomain,
  test_permission_manager_not_cleared_with_uri_contains_domain,

  // Content Preferences
  test_content_preferences_cleared_with_direct_match,
  test_content_preferences_cleared_with_subdomain,
  test_content_preferences_not_cleared_with_uri_contains_domain,

  // Storage
  test_storage_cleared,

  // Cache
  test_cache_cleared,
];

function run_test()
{
  for (let i = 0; i < tests.length; i++)
    add_task(tests[i]);

  run_next_test();
}
