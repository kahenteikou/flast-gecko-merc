/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

function debug(s) {
  // dump("-*- PushService.js: " + s + "\n");
}

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const Cr = Components.results;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/IndexedDBHelper.jsm");
Cu.import("resource://gre/modules/Timer.jsm");
Cu.import("resource://gre/modules/Preferences.jsm");
Cu.import("resource://gre/modules/commonjs/sdk/core/promise.js");

const prefs = new Preferences("services.push.");

const kPUSHDB_DB_NAME = "push";
const kPUSHDB_DB_VERSION = 1; // Change this if the IndexedDB format changes
const kPUSHDB_STORE_NAME = "push";
const kCONFLICT_RETRY_ATTEMPTS = 3; // If channelID registration says 409, how
                                    // many times to retry with a new channelID

const kERROR_CHID_CONFLICT = 409;   // Error code sent by push server if this
                                    // channel already exists on the server.

const kUDP_WAKEUP_WS_STATUS_CODE = 4774;  // WebSocket Close status code sent
                                          // by server to signal that it can
                                          // wake client up using UDP.

const kCHILD_PROCESS_MESSAGES = ["Push:Register", "Push:Unregister",
                                 "Push:Registrations"];

// This is a singleton
this.PushDB = function PushDB(aGlobal) {
  debug("PushDB()");

  // set the indexeddb database
  let idbManager = Cc["@mozilla.org/dom/indexeddb/manager;1"]
                     .getService(Ci.nsIIndexedDatabaseManager);
  idbManager.initWindowless(aGlobal);
  this.initDBHelper(kPUSHDB_DB_NAME, kPUSHDB_DB_VERSION,
                    [kPUSHDB_STORE_NAME], aGlobal);
};

this.PushDB.prototype = {
  __proto__: IndexedDBHelper.prototype,

  upgradeSchema: function(aTransaction, aDb, aOldVersion, aNewVersion) {
    debug("PushDB.upgradeSchema()")

    let objectStore = aDb.createObjectStore(kPUSHDB_STORE_NAME,
                                            { keyPath: "channelID" });

    // index to fetch records based on endpoints. used by unregister
    objectStore.createIndex("pushEndpoint", "pushEndpoint", { unique: true });
    // index to fetch records per manifest, so we can identify endpoints
    // associated with an app. Since an app can have multiple endpoints
    // uniqueness cannot be enforced
    objectStore.createIndex("manifestURL", "manifestURL", { unique: false });
  },

  /*
   * @param aChannelRecord
   *        The record to be added.
   * @param aSuccessCb
   *        Callback function to invoke with result ID.
   * @param aErrorCb [optional]
   *        Callback function to invoke when there was an error.
   */
  put: function(aChannelRecord, aSuccessCb, aErrorCb) {
    debug("put()");

    this.newTxn(
      "readwrite",
      kPUSHDB_STORE_NAME,
      function txnCb(aTxn, aStore) {
        debug("Going to put " + aChannelRecord.channelID);
        aStore.put(aChannelRecord).onsuccess = function setTxnResult(aEvent) {
          debug("Request successful. Updated record ID: " + aEvent.target.result);
        };
      },
      aSuccessCb,
      aErrorCb
    );
  },

  /*
   * @param aChannelID
   *        The ID of record to be deleted.
   * @param aSuccessCb
   *        Callback function to invoke with result.
   * @param aErrorCb [optional]
   *        Callback function to invoke when there was an error.
   */
  delete: function(aChannelID, aSuccessCb, aErrorCb) {
    debug("delete()");

    this.newTxn(
      "readwrite",
      kPUSHDB_STORE_NAME,
      function txnCb(aTxn, aStore) {
        debug("Going to delete " + aChannelID);
        aStore.delete(aChannelID);
      },
      aSuccessCb,
      aErrorCb
    );
  },

  getByPushEndpoint: function(aPushEndpoint, aSuccessCb, aErrorCb) {
    debug("getByPushEndpoint()");

    this.newTxn(
      "readonly",
      kPUSHDB_STORE_NAME,
      function txnCb(aTxn, aStore) {
        aTxn.result = undefined;

        var index = aStore.index("pushEndpoint");
        index.get(aPushEndpoint).onsuccess = function setTxnResult(aEvent) {
          aTxn.result = aEvent.target.result;
          debug("Fetch successful " + aEvent.target.result);
        }
      },
      aSuccessCb,
      aErrorCb
    );
  },

  getByChannelID: function(aChannelID, aSuccessCb, aErrorCb) {
    debug("getByChannelID()");

    this.newTxn(
      "readonly",
      kPUSHDB_STORE_NAME,
      function txnCb(aTxn, aStore) {
        aTxn.result = undefined;

        aStore.get(aChannelID).onsuccess = function setTxnResult(aEvent) {
          aTxn.result = aEvent.target.result;
          debug("Fetch successful " + aEvent.target.result);
        }
      },
      aSuccessCb,
      aErrorCb
    );
  },

  getAllByManifestURL: function(aManifestURL, aSuccessCb, aErrorCb) {
    debug("getAllByManifestURL()");
    if (!aManifestURL) {
      if (typeof aErrorCb == "function") {
        aErrorCb("PushDB.getAllByManifestURL: Got undefined aManifestURL");
      }
      return;
    }

    var self = this;
    this.newTxn(
      "readonly",
      kPUSHDB_STORE_NAME,
      function txnCb(aTxn, aStore) {
        var index = aStore.index("manifestURL");
        var range = self.dbGlobal.IDBKeyRange.only(aManifestURL);
        aTxn.result = [];
        index.openCursor(range).onsuccess = function(event) {
          var cursor = event.target.result;
          if (cursor) {
            debug(cursor.value.manifestURL + " " + cursor.value.channelID);
            aTxn.result.push(cursor.value);
            cursor.continue();
          }
        }
      },
      aSuccessCb,
      aErrorCb
    );
  },

  getAllChannelIDs: function(aSuccessCb, aErrorCb) {
    debug("getAllChannelIDs()");

    this.newTxn(
      "readonly",
      kPUSHDB_STORE_NAME,
      function txnCb(aTxn, aStore) {
        aStore.mozGetAll().onsuccess = function(event) {
          aTxn.result = event.target.result;
        }
      },
      aSuccessCb,
      aErrorCb
    );
  },

  drop: function(aSuccessCb, aErrorCb) {
    debug("drop()");
    this.newTxn(
      "readwrite",
      kPUSHDB_STORE_NAME,
      function txnCb(aTxn, aStore) {
        aStore.clear();
      },
      aSuccessCb(),
      aErrorCb()
    );
  }
};

/**
 * A proxy between the PushService and the WebSocket. The listener is used so
 * that the PushService can silence messages from the WebSocket by setting
 * PushWebSocketListener._pushService to null. This is required because
 * a WebSocket can continue to send messages or errors after it has been
 * closed but the PushService may not be interested in these. It's easier to
 * stop listening than to have checks at specific points.
 */
this.PushWebSocketListener = function(pushService) {
  this._pushService = pushService;
}

this.PushWebSocketListener.prototype = {
  onStart: function(context) {
    if (!this._pushService)
        return;
    this._pushService._wsOnStart(context);
  },

  onStop: function(context, statusCode) {
    if (!this._pushService)
        return;
    this._pushService._wsOnStop(context, statusCode);
  },

  onAcknowledge: function(context, size) {
    // EMPTY
  },

  onBinaryMessageAvailable: function(context, message) {
    // EMPTY
  },

  onMessageAvailable: function(context, message) {
    if (!this._pushService)
        return;
    this._pushService._wsOnMessageAvailable(context, message);
  },

  onServerClose: function(context, aStatusCode, aReason) {
    if (!this._pushService)
        return;
    this._pushService._wsOnServerClose(context, aStatusCode, aReason);
  }
}

/**
 * The implementation of the SimplePush system. This runs in the B2G parent
 * process and is started on boot. It uses WebSockets to communicate with the
 * server and PushDB (IndexedDB) for persistence.
 */
function PushService()
{
  debug("PushService Constructor.");
}

// websocket states
// websocket is off
const STATE_SHUT_DOWN = 0;
// websocket has been opened on client side, waiting for successful open
// (_wsOnStart)
const STATE_WAITING_FOR_WS_START = 1;
// websocket opened, hello sent, waiting for server reply (_handleHelloReply)
const STATE_WAITING_FOR_HELLO = 2;
// websocket operational, handshake completed, begin protocol messaging
const STATE_READY = 3;

PushService.prototype = {
  classID : Components.ID("{0ACE8D15-9B15-41F4-992F-C88820421DBF}"),

  QueryInterface : XPCOMUtils.generateQI([Ci.nsIObserver,
                                          Ci.nsIUDPServerSocketListener]),

  observe: function observe(aSubject, aTopic, aData) {
    switch (aTopic) {
      case "app-startup":

        if (!prefs.get("enabled"))
          return;

        Services.obs.addObserver(this, "final-ui-startup", false);
        Services.obs.addObserver(this, "profile-change-teardown", false);
        Services.obs.addObserver(this,
                                 "network-interface-state-changed",
                                 false);
        Services.obs.addObserver(this, "webapps-uninstall", false);
        break;
      case "final-ui-startup":
        Services.obs.removeObserver(this, "final-ui-startup");
        this.init();
        break;
      case "profile-change-teardown":
        Services.obs.removeObserver(this, "profile-change-teardown");
        this._shutdown();
        break;
      case "network-interface-state-changed":
        debug("network-interface-state-changed");

        if (this._udpServer) {
          this._udpServer.close();
        }

        this._shutdownWS();

        // Check to see if we need to do anything.
        this._db.getAllChannelIDs(function(channelIDs) {
          if (channelIDs.length > 0) {
            this._beginWSSetup();
          }
        }.bind(this));
        break;
      case "nsPref:changed":
        if (aData == "services.push.serverURL") {
          debug("services.push.serverURL changed! websocket. new value " +
                prefs.get("serverURL"));
          this._shutdownWS();
        }
        break;
      case "timer-callback":
        if (aSubject == this._requestTimeoutTimer) {
          if (Object.keys(this._pendingRequests).length == 0)
            this._requestTimeoutTimer.cancel();

          for (var channelID in this._pendingRequests) {
            var duration = Date.now() - this._pendingRequests[channelID].ctime;
            if (duration > this._requestTimeout) {
              debug("Request timeout: Removing " + channelID);
              this._pendingRequests[channelID]
                .deferred.reject({status: 0, error: "Timeout"});

              delete this._pendingRequests[channelID];
              for (var i = this._requestQueue.length - 1; i >= 0; --i)
                if (this._requestQueue[i].channelID == channelID)
                  this._requestQueue.splice(i, 1);
            }
          }
        }
        else if (aSubject == this._retryTimeoutTimer) {
          this._beginWSSetup();
        }
        break;
      case "webapps-uninstall":
        debug("webapps-uninstall");
        let appsService = Cc["@mozilla.org/AppsService;1"]
                            .getService(Ci.nsIAppsService);
        var app = appsService.getAppFromObserverMessage(aData);
        if (!app) {
          debug("webapps-uninstall: No app found " + aData.origin);
          return;
        }

        this._db.getAllByManifestURL(app.manifestURL, function(records) {
          debug("Got " + records.length);
          for (var i = 0; i < records.length; i++) {
            this._db.delete(records[i].channelID, null, function() {
              debug("app uninstall: " + app.manifestURL + " Could not delete entry " + records[i].channelID);
            });
            // courtesy, but don't establish a connection
            // just for it
            if (this._ws) {
              debug("Had a connection, so telling the server");
              this._request("unregister", {channelID: records[i].channelID});
            }
          }
        }.bind(this), function() {
          debug("Error in getAllByManifestURL: url " + app.manifestURL);
        });

    }
  },

  get _UAID() {
    return prefs.get("userAgentID");
  },

  set _UAID(newID) {
    if (typeof(newID) !== "string") {
      debug("Got invalid, non-string UAID " + newID +
            ". Not updating userAgentID");
      return;
    }
    debug("New _UAID: " + newID);
    prefs.set("userAgentID", newID);
  },

  // keeps requests buffered if the websocket disconnects or is not connected
  _requestQueue: [],
  _ws: null,
  _pendingRequests: {},
  _currentState: STATE_SHUT_DOWN,
  _requestTimeout: 0,
  _requestTimeoutTimer: null,

  /**
   * How retries work:  The goal is to ensure websocket is always up on
   * networks not supporting UDP. So the websocket should only be shutdown if
   * onServerClose indicates UDP wakeup.  If WS is closed due to socket error,
   * _socketError() is called.  The retry timer is started and when it times
   * out, beginWSSetup() is called again.
   *
   * On a successful connection, the timer is cancelled if it is running and
   * the values are reset to defaults.
   *
   * If we are in the middle of a timeout (i.e. waiting), but
   * a register/unregister is called, we don't want to wait around anymore.
   * _sendRequest will automatically call beginWSSetup(), which will cancel the
   * timer. In addition since the state will have changed, even if a pending
   * timer event comes in (because the timer fired the event before it was
   * cancelled), so the connection won't be reset.
   */
  _retryTimeoutTimer: null,
  _retryFailCount: 0,

  /**
   * According to the WS spec, servers should immediately close the underlying
   * TCP connection after they close a WebSocket. This causes wsOnStop to be
   * called with error NS_BASE_STREAM_CLOSED. Since the client has to keep the
   * WebSocket up, it should try to reconnect. But if the server closes the
   * WebSocket because it will wake up the client via UDP, then the client
   * shouldn't re-establish the connection. If the server says that it will
   * wake up the client over UDP, this is set to true in wsOnServerClose. It is
   * checked in wsOnStop.
   */
  _willBeWokenUpByUDP: false,

  init: function() {
    debug("init()");
    this._db = new PushDB(this);

    let ppmm = Cc["@mozilla.org/parentprocessmessagemanager;1"]
                 .getService(Ci.nsIMessageBroadcaster);

    kCHILD_PROCESS_MESSAGES.forEach(function addMessage(msgName) {
        ppmm.addMessageListener(msgName, this);
    }.bind(this));

    this._requestTimeout = prefs.get("requestTimeout");

    this._udpPort = prefs.get("udp.port");

    this._db.getAllChannelIDs(
      function(channelIDs) {
        if (channelIDs.length > 0) {
          debug("Found registered channelIDs. Starting WebSocket");
          this._beginWSSetup();
        }
      }.bind(this),

      function(error) {
        debug("db error " + error);
      }
    );

    // This is only used for testing. Different tests require connecting to
    // slightly different URLs.
    prefs.observe("serverURL", this);
  },

  _shutdownWS: function() {
    debug("shutdownWS()");
    this._currentState = STATE_SHUT_DOWN;
    this._willBeWokenUpByUDP = false;
    if (this._wsListener)
      this._wsListener._pushService = null;
    try {
        this._ws.close(0, null);
    } catch (e) {}
    this._ws = null;
  },

  _shutdown: function() {
    debug("_shutdown()");
    this._db.close();
    this._db = null;

    if (this._udpServer) {
      this._udpServer.close();
    }

    // All pending requests (ideally none) are dropped at this point. We
    // shouldn't have any applications performing registration/unregistration
    // or receiving notifications.
    this._shutdownWS();

    debug("shutdown complete!");
  },

  // aStatusCode is an NS error from Components.results
  _socketError: function(aStatusCode) {
    debug("socketError()");

    // Calculate new timeout, but cap it to
    var retryTimeout = prefs.get("retryBaseInterval") *
                       Math.pow(2, this._retryFailCount);

    // It is easier to express the max interval as a pref in milliseconds,
    // rather than have it as a number and make people do the calculation of
    // retryBaseInterval * 2^maxRetryFailCount.
    retryTimeout = Math.min(retryTimeout, prefs.get("maxRetryInterval"));

    this._retryFailCount++;

    debug("Retry in " + retryTimeout + " Try number " + this._retryFailCount);

    if (!this._retryTimeoutTimer) {
      this._retryTimeoutTimer = Cc["@mozilla.org/timer;1"]
                                  .createInstance(Ci.nsITimer);
    }

    this._retryTimeoutTimer.init(this,
                                 retryTimeout,
                                 Ci.nsITimer.TYPE_ONE_SHOT);
  },

  _beginWSSetup: function() {
    debug("beginWSSetup()");
    if (this._currentState != STATE_SHUT_DOWN) {
      debug("_beginWSSetup: Not in shutdown state! Current state " +
            this._currentState);
      return;
    }

    var serverURL = prefs.get("serverURL");
    if (!serverURL) {
      debug("No services.push.serverURL found!");
      return;
    }

    var uri;
    try {
      uri = Services.io.newURI(serverURL, null, null);
    } catch(e) {
      debug("Error creating valid URI from services.push.serverURL (" +
            serverURL + ")");
      return;
    }

    if (uri.scheme === "wss") {
      this._ws = Cc["@mozilla.org/network/protocol;1?name=wss"]
                   .createInstance(Ci.nsIWebSocketChannel);
    }
    else if (uri.scheme === "ws") {
      debug("Push over an insecure connection (ws://) is not allowed!");
      return;
    }
    else {
      debug("Unsupported websocket scheme " + uri.scheme);
      return;
    }

    debug("serverURL: " + uri.spec);
    this._wsListener = new PushWebSocketListener(this);
    this._ws.protocol = "push-notification";
    this._ws.pingInterval = prefs.get("websocketPingInterval");
    this._ws.asyncOpen(uri, serverURL, this._wsListener, null);
    this._currentState = STATE_WAITING_FOR_WS_START;
  },

  /**
   * Protocol handler invoked by server message.
   */
  _handleHelloReply: function(reply) {
    debug("handleHelloReply()");
    if (this._currentState != STATE_WAITING_FOR_HELLO) {
      debug("Unexpected state " + this._currentState +
            "(expected STATE_WAITING_FOR_HELLO)");
      this._shutdownWS();
      return;
    }

    if (typeof reply.uaid !== "string") {
      debug("No UAID received or non string UAID received");
      this._shutdownWS();
      return;
    }

    if (reply.uaid === "") {
      debug("Empty UAID received!");
      this._shutdownWS();
      return;
    }

    // To avoid sticking extra large values sent by an evil server into prefs.
    if (reply.uaid.length > 128) {
      debug("UAID received from server was too long: " +
            reply.uaid);
      this._shutdownWS();
      return;
    }

    function finishHandshake() {
      this._UAID = reply.uaid;
      this._currentState = STATE_READY;
      this._processNextRequestInQueue();
    }

    // By this point we've got a UAID from the server that we are ready to
    // accept.
    //
    // If we already had a valid UAID before, we have to ask apps to
    // re-register.
    if (this._UAID && this._UAID != reply.uaid) {
      debug("got new UAID: all re-register");

      this._notifyAllAppsRegister()
          .then(this._dropRegistrations.bind(this))
          .then(finishHandshake.bind(this));

      return;
    }

    // otherwise we are good to go
    finishHandshake.bind(this)();
  },

  /**
   * Protocol handler invoked by server message.
   */
  _handleRegisterReply: function(reply) {
    debug("handleRegisterReply()");
    if (typeof reply.channelID !== "string" ||
        typeof this._pendingRequests[reply.channelID] !== "object")
      return;

    var tmp = this._pendingRequests[reply.channelID];
    delete this._pendingRequests[reply.channelID];
    if (Object.keys(this._pendingRequests).length == 0 &&
        this._requestTimeoutTimer)
      this._requestTimeoutTimer.cancel();

    if (reply.status == 200) {
      tmp.deferred.resolve(reply);
    } else {
      tmp.deferred.reject(reply);
    }
  },

  /**
   * Protocol handler invoked by server message.
   */
  _handleUnregisterReply: function(reply) {
    debug("handleUnregisterReply()");
    if (typeof reply.channelID !== "string" ||
        typeof this._pendingRequests[reply.channelID] !== "object")
      return;

    var tmp = this._pendingRequests[reply.channelID];
    delete this._pendingRequests[reply.channelID];
    if (Object.keys(this._pendingRequests).length == 0 &&
        this._requestTimeoutTimer)
      this._requestTimeoutTimer.cancel();

    if (reply.status == 200) {
      tmp.deferred.resolve(reply);
    } else {
      tmp.deferred.reject(reply);
    }
  },

  /**
   * Protocol handler invoked by server message.
   */
  _handleNotificationReply: function(reply) {
    debug("handleNotificationReply()");
    if (typeof reply.updates !== 'object') {
      debug("No 'updates' field in response. Type = " + typeof reply.updates);
      return;
    }

    debug("Reply updates: " + reply.updates.length);
    for (var i = 0; i < reply.updates.length; i++) {
      var update = reply.updates[i];
      debug("Update: " + update.channelID + ": " + update.version);
      if (typeof update.channelID !== "string") {
        debug("Invalid update literal at index " + i);
        continue;
      }

      if (update.version === undefined) {
        debug("update.version does not exist");
        continue;
      }

      var version = update.version;

      if (typeof version === "string") {
        version = parseInt(version, 10);
      }

      if (typeof version === "number" && version >= 0) {
        // FIXME(nsm): this relies on app update notification being infallible!
        // eventually fix this
        this._receivedUpdate(update.channelID, version);
        this._sendAck(update.channelID, version);
      }
    }
  },

  // FIXME(nsm): batch acks for efficiency reasons.
  _sendAck: function(channelID, version) {
    debug("sendAck()");
    this._send('ack', {
      updates: [{channelID: channelID, version: version}]
    });
  },

  /*
   * Must be used only by request/response style calls over the websocket.
   */
  _sendRequest: function(action, data) {
    debug("sendRequest() " + action);
    if (typeof data.channelID !== "string") {
      debug("Received non-string channelID");
      return;
    }

    var deferred = Promise.defer();

    if (Object.keys(this._pendingRequests).length == 0) {
      // start the timer since we now have at least one request
      if (!this._requestTimeoutTimer)
        this._requestTimeoutTimer = Cc["@mozilla.org/timer;1"]
                                      .createInstance(Ci.nsITimer);
      this._requestTimeoutTimer.init(this,
                                     this._requestTimeout,
                                     Ci.nsITimer.TYPE_REPEATING_SLACK);
    }

    this._pendingRequests[data.channelID] = { deferred: deferred,
                                              ctime: Date.now() };

    this._send(action, data);
    return deferred.promise;
  },

  _send: function(action, data) {
    debug("send()");
    this._requestQueue.push([action, data]);
    debug("Queued " + action);
    this._processNextRequestInQueue();
  },

  _processNextRequestInQueue: function() {
    debug("_processNextRequestInQueue()");

    if (this._requestQueue.length == 0) {
      debug("Request queue empty");
      return;
    }

    if (this._currentState != STATE_READY) {
      if (!this._ws) {
        // This will end up calling processNextRequestInQueue().
        this._beginWSSetup();
      }
      else {
        // We have a socket open so we are just waiting for hello to finish.
        // That will call processNextRequestInQueue().
      }
      return;
    }

    [action, data] = this._requestQueue.shift();
    data.messageType = action;
    if (!this._ws) {
      // If our websocket is not ready and our state is STATE_READY we may as
      // well give up all assumptions about the world and start from scratch
      // again.  Discard the message itself, let the timeout notify error to
      // the app.
      debug("This should never happen!");
      this._shutdownWS();
    }

    this._ws.sendMsg(JSON.stringify(data));
    // Process the next one as soon as possible.
    setTimeout(this._processNextRequestInQueue.bind(this), 0);
  },

  _receivedUpdate: function(aChannelID, aLatestVersion) {
    debug("Updating: " + aChannelID + " -> " + aLatestVersion);

    var compareRecordVersionAndNotify = function(aPushRecord) {
      debug("compareRecordVersionAndNotify()");
      if (!aPushRecord) {
        debug("No record for channel ID " + aChannelID);
        return;
      }

      if (aPushRecord.version == null ||
          aPushRecord.version < aLatestVersion) {
        debug("Version changed, notifying app and updating DB");
        aPushRecord.version = aLatestVersion;
        this._notifyApp(aPushRecord);
        this._updatePushRecord(aPushRecord)
          .then(
            null,
            function(e) {
              debug("Error updating push record");
            }
          );
      }
      else {
        debug("No significant version change: " + aLatestVersion);
      }
    }

    var recoverNoSuchChannelID = function(aChannelIDFromServer) {
      debug("Could not get channelID " + aChannelIDFromServer + " from DB");
    }

    this._db.getByChannelID(aChannelID,
                            compareRecordVersionAndNotify.bind(this),
                            recoverNoSuchChannelID.bind(this));
  },

  // Fires a push-register system message to all applications that have
  // registrations.
  _notifyAllAppsRegister: function() {
    debug("notifyAllAppsRegister()");
    var deferred = Promise.defer();

    // records are objects describing the registrations as stored in IndexedDB.
    function wakeupRegisteredApps(records) {
      // Pages to be notified.
      // wakeupTable[manifestURL] -> [ pageURL ]
      var wakeupTable = {};
      for (var i = 0; i < records.length; i++) {
        var record = records[i];
        if (!(record.manifestURL in wakeupTable))
          wakeupTable[record.manifestURL] = [];

        wakeupTable[record.manifestURL].push(record.pageURL);
      }

      let messenger = Cc["@mozilla.org/system-message-internal;1"]
                        .getService(Ci.nsISystemMessagesInternal);

      for (var manifestURL in wakeupTable) {
        wakeupTable[manifestURL].forEach(function(pageURL) {
          messenger.sendMessage('push-register', {},
                                Services.io.newURI(pageURL, null, null),
                                Services.io.newURI(manifestURL, null, null));
        });
      }

      deferred.resolve();
    }

    this._db.getAllChannelIDs(wakeupRegisteredApps, deferred.reject);

    return deferred.promise;
  },

  _notifyApp: function(aPushRecord) {
    if (!aPushRecord || !aPushRecord.pageURL || !aPushRecord.manifestURL) {
      debug("notifyApp() something is undefined.  Dropping notification");
      return;
    }

    debug("notifyApp() " + aPushRecord.pageURL +
          "  " + aPushRecord.manifestURL);
    var pageURI = Services.io.newURI(aPushRecord.pageURL, null, null);
    var manifestURI = Services.io.newURI(aPushRecord.manifestURL, null, null);
    var message = {
      pushEndpoint: aPushRecord.pushEndpoint,
      version: aPushRecord.version
    };
    let messenger = Cc["@mozilla.org/system-message-internal;1"]
                      .getService(Ci.nsISystemMessagesInternal);
    messenger.sendMessage('push', message, pageURI, manifestURI);
  },

  _updatePushRecord: function(aPushRecord) {
    debug("updatePushRecord()");
    var deferred = Promise.defer();
    this._db.put(aPushRecord, deferred.resolve, deferred.reject);
    return deferred.promise;
  },

  _dropRegistrations: function() {
    var deferred = Promise.defer();
    this._db.drop(deferred.resolve, deferred.reject);
    return deferred.promise;
  },

  receiveMessage: function(aMessage) {
    debug("receiveMessage(): " + aMessage.name);

    if (kCHILD_PROCESS_MESSAGES.indexOf(aMessage.name) == -1) {
      debug("Invalid message from child " + aMessage.name);
      return;
    }

    let mm = aMessage.target.QueryInterface(Ci.nsIMessageSender);
    let json = aMessage.data;
    this[aMessage.name.slice("Push:".length).toLowerCase()](json, mm);
  },

  /**
   * Called on message from the child process. aPageRecord is an object sent by
   * navigator.push, identifying the sending page and other fields.
   */
  register: function(aPageRecord, aMessageManager) {
    debug("register()");

    let uuidGenerator = Cc["@mozilla.org/uuid-generator;1"]
                          .getService(Ci.nsIUUIDGenerator);
    // generateUUID() gives a UUID surrounded by {...}, slice them off.
    var channelID = uuidGenerator.generateUUID().toString()
                      .slice(1)
                      .slice(0, -1);

    this._sendRequest("register", {channelID: channelID})
      .then(
        this._onRegisterSuccess.bind(this, aPageRecord, channelID),
        this._onRegisterError.bind(this, aPageRecord, aMessageManager)
      )
      .then(
        function(message) {
          aMessageManager.sendAsyncMessage("PushService:Register:OK", message);
        },
        function() {
          aMessageManager.sendAsyncMessage("PushService:Register:KO", message);
      });
  },

  /**
   * Exceptions thrown in _onRegisterSuccess are caught by the promise obtained
   * from _sendRequest, causing the promise to be rejected instead.
   */
  _onRegisterSuccess: function(aPageRecord, generatedChannelID, data) {
    debug("_onRegisterSuccess()");
    var deferred = Promise.defer();
    var message = { requestID: aPageRecord.requestID };

    if (typeof data.channelID !== "string") {
      debug("Invalid channelID " + message);
      message["error"] = "Invalid channelID received";
      throw message;
    }
    else if (data.channelID != generatedChannelID) {
      debug("Server replied with different channelID " + data.channelID +
            " than what UA generated " + generatedChannelID);
      message["error"] = "Server sent 200 status code but different channelID";
      throw message;
    }

    try {
      Services.io.newURI(data.pushEndpoint, null, null);
    }
    catch (e) {
      debug("Invalid pushEndpoint " + data.pushEndpoint);
      message["error"] = "Invalid pushEndpoint " + data.pushEndpoint;
      throw message;
    }

    var record = {
      channelID: data.channelID,
      pushEndpoint: data.pushEndpoint,
      pageURL: aPageRecord.pageURL,
      manifestURL: aPageRecord.manifestURL,
      version: null
    };

    this._updatePushRecord(record)
      .then(
        function() {
          message["pushEndpoint"] = data.pushEndpoint;
          deferred.resolve(message);
        },
        function(error) {
          // Unable to save.
          this._sendRequest("unregister", {channelID: record.channelID});
          message["error"] = error;
          deferred.reject(message);
        }
      );

    return deferred.promise;
  },

  /**
   * Exceptions thrown in _onRegisterError are caught by the promise obtained
   * from _sendRequest, causing the promise to be rejected instead.
   */
  _onRegisterError: function(aPageRecord, aMessageManager, reply) {
    debug("_onRegisterError()");
    switch (reply.status) {
      case kERROR_CHID_CONFLICT:
        if (typeof aPageRecord._attempts !== "number")
          aPageRecord._attempts = 0;

        if (aPageRecord._attempts < kCONFLICT_RETRY_ATTEMPTS) {
          aPageRecord._attempts++;
          // Since register is async, it's OK to launch it in a callback.
          debug("CONFLICT: trying again");
          this.register(aPageRecord, aMessageManager);
          return;
        }
        throw { requestID: aPageRecord.requestID, error: "conflict" };
      default:
        debug("General failure " + reply.status);
        throw { requestID: aPageRecord.requestID, error: reply.error };
    }
  },

  /**
   * Called on message from the child process.
   *
   * Why is the record being deleted from the local database before the server
   * is told?
   *
   * Unregistration is for the benefit of the app and the AppServer
   * so that the AppServer does not keep pinging a channel the UserAgent isn't
   * watching The important part of the transaction in this case is left to the
   * app, to tell its server of the unregistration.  Even if the request to the
   * PushServer were to fail, it would not affect correctness of the protocol,
   * and the server GC would just clean up the channelID eventually.  Since the
   * appserver doesn't ping it, no data is lost.
   *
   * If rather we were to unregister at the server and update the database only
   * on success: If the server receives the unregister, and deletes the
   * channelID, but the response is lost because of network failure, the
   * application is never informed. In addition the application may retry the
   * unregister when it fails due to timeout at which point the server will say
   * it does not know of this unregistration.  We'll have to make the
   * registration/unregistration phases have retries and attempts to resend
   * messages from the server, and have the client acknowledge. On a server,
   * data is cheap, reliable notification is not.
   */
  unregister: function(aPageRecord, aMessageManager) {
    debug("unregister()");

    var fail = function(error) {
      debug("unregister() fail() error " + error);
      var message = {requestID: aPageRecord.requestID, error: error};
      aMessageManager.sendAsyncMessage("PushService:Unregister:KO", message);
    }

    this._db.getByPushEndpoint(aPageRecord.pushEndpoint, function(record) {
      // Non-owner tried to unregister, say success, but don't do anything.
      if (record.manifestURL !== aPageRecord.manifestURL) {
        aMessageManager.sendAsyncMessage("PushService:Unregister:OK", {
          requestID: aPageRecord.requestID,
          pushEndpoint: aPageRecord.pushEndpoint
        });
        return;
      }

      this._db.delete(record.channelID, function() {
        // Let's be nice to the server and try to inform it, but we don't care
        // about the reply.
        this._sendRequest("unregister", {channelID: record.channelID});
        aMessageManager.sendAsyncMessage("PushService:Unregister:OK", {
          requestID: aPageRecord.requestID,
          pushEndpoint: aPageRecord.pushEndpoint
        });
      }.bind(this), fail);
    }.bind(this), fail);
  },

  /**
   * Called on message from the child process
   */
  registrations: function(aPageRecord, aMessageManager) {
    debug("registrations()");

    if (aPageRecord.manifestURL) {
      this._db.getAllByManifestURL(aPageRecord.manifestURL,
        this._onRegistrationsSuccess.bind(this, aPageRecord, aMessageManager),
        this._onRegistrationsError.bind(this, aPageRecord, aMessageManager));
    }
    else {
      this._onRegistrationsError(aPageRecord, aMessageManager);
    }
  },

  _onRegistrationsSuccess: function(aPageRecord,
                                    aMessageManager,
                                    pushRecords) {
    var registrations = [];
    pushRecords.forEach(function(pushRecord) {
      registrations.push({
          __exposedProps__: { pushEndpoint: 'r', version: 'r' },
          pushEndpoint: pushRecord.pushEndpoint,
          version: pushRecord.version
      });
    });
    aMessageManager.sendAsyncMessage("PushService:Registrations:OK", {
      requestID: aPageRecord.requestID,
      registrations: registrations
    });
  },

  _onRegistrationsError: function(aPageRecord, aMessageManager) {
    aMessageManager.sendAsyncMessage("PushService:Registrations:KO", {
      requestID: aPageRecord.requestID,
      error: "Database error"
    });
  },

  // begin Push protocol handshake
  _wsOnStart: function(context) {
    debug("wsOnStart()");
    if (this._currentState != STATE_WAITING_FOR_WS_START) {
      debug("NOT in STATE_WAITING_FOR_WS_START. Current state " +
            this._currentState + ". Skipping");
      return;
    }

    if (this._retryTimeoutTimer)
      this._retryTimeoutTimer.cancel();

    // Since we've had a successful connection reset the retry fail count.
    this._retryFailCount = 0;

    var data = {
      messageType: "hello",
    }

    if (this._UAID)
      data["uaid"] = this._UAID;

    var networkState = this._getNetworkState();
    if (networkState.ip) {
      // Hostport is apparently a thing.
      data["wakeup_hostport"] = {
        ip: networkState.ip,
        port: this._udpPort
      };

      data["mobilenetwork"] = {
        mcc: networkState.mcc,
        mnc: networkState.mnc
      };
    }

    function sendHelloMessage(ids) {
      // On success, ids is an array, on error its not.
      data["channelIDs"] = ids.map ?
                           ids.map(function(el) { return el.channelID; }) : [];
      this._ws.sendMsg(JSON.stringify(data));
      this._currentState = STATE_WAITING_FOR_HELLO;
    }

    this._db.getAllChannelIDs(sendHelloMessage.bind(this),
                              sendHelloMessage.bind(this));
  },

  /**
   * This statusCode is not the websocket protocol status code, but the TCP
   * connection close status code.
   *
   * If we do not explicitly call ws.close() then statusCode is always
   * NS_BASE_STREAM_CLOSED, even on a successful close.
   */
  _wsOnStop: function(context, statusCode) {
    debug("wsOnStop()");
    if (statusCode != Cr.NS_OK &&
        !(statusCode == Cr.NS_BASE_STREAM_CLOSED && this._willBeWokenUpByUDP)) {
      debug("Socket error " + statusCode);
      this._socketError(statusCode);
    }

    this._shutdownWS();
  },

  _wsOnMessageAvailable: function(context, message) {
    debug("wsOnMessageAvailable() " + message);
    var reply = undefined;
    try {
      reply = JSON.parse(message);
    } catch(e) {
      debug("Parsing JSON failed. text : " + message);
      return;
    }

    if (typeof reply.messageType != "string") {
      debug("messageType not a string " + reply.messageType);
      return;
    }

    // A whitelist of protocol handlers. Add to these if new messages are added
    // in the protocol.
    var handlers = ["Hello", "Register", "Unregister", "Notification"];

    // Build up the handler name to call from messageType.
    // e.g. messageType == "register" -> _handleRegisterReply.
    var handlerName = reply.messageType[0].toUpperCase() +
                      reply.messageType.slice(1).toLowerCase();

    if (handlers.indexOf(handlerName) == -1) {
      debug("No whitelisted handler " + handlerName + ". messageType: " +
            reply.messageType);
      return;
    }

    var handler = "_handle" + handlerName + "Reply";

    if (typeof this[handler] !== "function") {
      debug("Handler whitelisted but not implemented! " + handler);
      return;
    }

    this[handler](reply);
  },

  /**
   * The websocket should never be closed. Since we don't call ws.close(),
   * _wsOnStop() receives error code NS_BASE_STREAM_CLOSED (see comment in that
   * function), which calls socketError and re-establishes the WebSocket
   * connection.
   *
   * If the server said it'll use UDP for wakeup, we set _willBeWokenUpByUDP
   * and stop reconnecting in _wsOnStop().
   */
  _wsOnServerClose: function(context, aStatusCode, aReason) {
    debug("wsOnServerClose() " + aStatusCode + " " + aReason);

    // Switch over to UDP.
    if (aStatusCode == kUDP_WAKEUP_WS_STATUS_CODE) {
      debug("Server closed with promise to wake up");
      this._willBeWokenUpByUDP = true;
      // TODO: there should be no pending requests
      this._listenForUDPWakeup();
    }
  },

  _listenForUDPWakeup: function() {
    debug("listenForUDPWakeup()");

    if (this._udpServer) {
      debug("UDP Server already running");
      return;
    }

    if (!this._getNetworkState().ip) {
      debug("No IP");
      return;
    }

    if (!prefs.get("udp.wakeupEnabled")) {
      debug("UDP support disabled");
      return;
    }

    this._udpServer = Cc["@mozilla.org/network/server-socket-udp;1"]
                        .createInstance(Ci.nsIUDPServerSocket);
    this._udpServer.init(this._udpPort, false);
    this._udpServer.asyncListen(this);
    debug("listenForUDPWakeup listening on " + this._udpPort);
  },

  /**
   * Called by UDP Server Socket. As soon as a ping is recieved via UDP,
   * reconnect the WebSocket and get the actual data.
   */
  onPacketReceived: function(aServ, aMessage) {
    debug("Recv UDP datagram on port: " + this._udpPort);
    this._beginWSSetup();
  },

  /**
   * Called by UDP Server Socket if the socket was closed for some reason.
   *
   * If this happens, we reconnect the WebSocket to not miss out on
   * notifications.
   */
  onStopListening: function(aServ, aStatus) {
    debug("UDP Server socket was shutdown. Status: " + aStatus);
    this._beginWSSetup();
  },

  /**
   * Get mobile network information to decide if the client is capable of being woken
   * up by UDP (which currently just means having an mcc and mnc along with an
   * IP).
   */
  _getNetworkState: function() {
    debug("getNetworkState()");
    try {
      var nm = Cc["@mozilla.org/network/manager;1"].getService(Ci.nsINetworkManager);
      if (nm.active && nm.active.type == Ci.nsINetworkInterface.NETWORK_TYPE_MOBILE) {
        var mcp = Cc["@mozilla.org/ril/content-helper;1"].getService(Ci.nsIMobileConnectionProvider);
        if (mcp.iccInfo) {
          debug("Running on mobile data");
          return {
            mcc: mcp.iccInfo.mcc,
            mnc: mcp.iccInfo.mnc,
            ip:  nm.active.ip
          }
        }
      }
    } catch (e) {}

    debug("Running on wifi");

    return {
      mcc: 0,
      mnc: 0,
      ip: undefined
    };
  }
}

this.NSGetFactory = XPCOMUtils.generateNSGetFactory([PushService]);
