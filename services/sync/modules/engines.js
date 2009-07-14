/* ***** BEGIN LICENSE BLOCK *****
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
 * The Original Code is Bookmarks Sync.
 *
 * The Initial Developer of the Original Code is Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2007
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *  Dan Mills <thunder@mozilla.com>
 *  Myk Melez <myk@mozilla.org>
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

const EXPORTED_SYMBOLS = ['Engines', 'Engine', 'SyncEngine'];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://weave/ext/Observers.js");
Cu.import("resource://weave/ext/Sync.js");
Cu.import("resource://weave/log4moz.js");
Cu.import("resource://weave/constants.js");
Cu.import("resource://weave/util.js");
Cu.import("resource://weave/resource.js");
Cu.import("resource://weave/identity.js");
Cu.import("resource://weave/stores.js");
Cu.import("resource://weave/trackers.js");

Cu.import("resource://weave/base_records/wbo.js");
Cu.import("resource://weave/base_records/keys.js");
Cu.import("resource://weave/base_records/crypto.js");
Cu.import("resource://weave/base_records/collection.js");

// Singleton service, holds registered engines

Utils.lazy(this, 'Engines', EngineManagerSvc);

function EngineManagerSvc() {
  this._engines = {};
  this._log = Log4Moz.repository.getLogger("Service.Engines");
  this._log.level = Log4Moz.Level[Svc.Prefs.get(
    "log.logger.service.engines", "Debug")];
}
EngineManagerSvc.prototype = {
  get: function EngMgr_get(name) {
    // Return an array of engines if we have an array of names
    if (Utils.isArray(name)) {
      let engines = [];
      name.forEach(function(name) {
        let engine = this.get(name);
        if (engine)
          engines.push(engine);
      }, this);
      return engines;
    }

    let engine = this._engines[name];
    if (!engine)
      this._log.debug("Could not get engine: " + name);
    return engine;
  },
  getAll: function EngMgr_getAll() {
    let ret = [];
    for (key in this._engines) {
      ret.push(this._engines[key]);
    }
    return ret;
  },
  getEnabled: function EngMgr_getEnabled() {
    let ret = [];
    for (key in this._engines) {
      if(this._engines[key].enabled)
        ret.push(this._engines[key]);
    }
    return ret;
  },

  /**
   * Register an Engine to the service. Alternatively, give an array of engine
   * objects to register.
   *
   * @param engineObject
   *        Engine object used to get an instance of the engine
   * @return The engine object if anything failed
   */
  register: function EngMgr_register(engineObject) {
    if (Utils.isArray(engineObject))
      return engineObject.map(this.register, this);

    try {
      let name = engineObject.prototype.name;
      if (name in this._engines)
        this._log.error("Engine '" + name + "' is already registered!");
      else
        this._engines[name] = new engineObject();
    }
    catch(ex) {
      let mesg = ex.message ? ex.message : ex;
      let name = engineObject || "";
      name = name.prototype || "";
      name = name.name || "";

      let out = "Could not initialize engine '" + name + "': " + mesg;
      dump(out);
      this._log.error(out);

      return engineObject;
    }
  },
  unregister: function EngMgr_unregister(val) {
    let name = val;
    if (val instanceof Engine)
      name = val.name;
    delete this._engines[name];
  }
};

function Engine() { this._init(); }
Engine.prototype = {
  name: "engine",
  displayName: "Boring Engine",
  logName: "Engine",

  // _storeObj, and _trackerObj should to be overridden in subclasses

  _storeObj: Store,
  _trackerObj: Tracker,

  get enabled() Svc.Prefs.get("engine." + this.name, null),
  set enabled(val) Svc.Prefs.set("engine." + this.name, !!val),

  get score() this._tracker.score,

  get _store() {
    if (!this.__store)
      this.__store = new this._storeObj();
    return this.__store;
  },

  get _tracker() {
    if (!this.__tracker)
      this.__tracker = new this._trackerObj();
    return this.__tracker;
  },

  _init: function Engine__init() {
    let levelPref = "log.logger.engine." + this.name;
    let level = "Debug";
    try { level = Utils.prefs.getCharPref(levelPref); }
    catch (e) { /* ignore unset prefs */ }

    this._notify = Utils.notify("weave:engine:");
    this._log = Log4Moz.repository.getLogger("Engine." + this.logName);
    this._log.level = Log4Moz.Level[level];

    this._tracker; // initialize tracker to load previously changed IDs
    this._log.debug("Engine initialized");
  },

  sync: function Engine_sync() {
    if (!this._sync)
      throw "engine does not implement _sync method";
    this._notify("sync", this.name, this._sync)();
  },

  wipeServer: function Engine_wipeServer() {
    if (!this._wipeServer)
      throw "engine does not implement _wipeServer method";
    this._notify("wipe-server", this.name, this._wipeServer)();
  },

  /**
   * Get rid of any local meta-data
   */
  resetClient: function Engine_resetClient() {
    if (!this._resetClient)
      throw "engine does not implement _resetClient method";

    this._notify("reset-client", this.name, this._resetClient)();
  },

  _wipeClient: function Engine__wipeClient() {
    this.resetClient();
    this._log.debug("Deleting all local data");
    this._store.wipe();
  },

  wipeClient: function Engine_wipeClient() {
    this._notify("wipe-client", this.name, this._wipeClient)();
  }
};

function SyncEngine() { this._init(); }
SyncEngine.prototype = {
  __proto__: Engine.prototype,

  _recordObj: CryptoWrapper,

  get baseURL() {
    let url = Svc.Prefs.get("clusterURL");
    if (!url)
      return null;
    if (url[url.length-1] != '/')
      url += '/';
    url += "0.3/user/";
    return url;
  },

  get engineURL() {
    return this.baseURL + ID.get('WeaveID').username + '/' + this.name + '/';
  },

  get cryptoMetaURL() {
    return this.baseURL + ID.get('WeaveID').username + '/crypto/' + this.name;
  },

  get lastSync() {
    return parseFloat(Svc.Prefs.get(this.name + ".lastSync", "0"));
  },
  set lastSync(value) {
    // Reset the pref in-case it's a number instead of a string
    Svc.Prefs.reset(this.name + ".lastSync");
    // Store the value as a string to keep floating point precision
    Svc.Prefs.set(this.name + ".lastSync", value.toString());
  },
  resetLastSync: function SyncEngine_resetLastSync() {
    this._log.debug("Resetting " + this.name + " last sync time");
    Svc.Prefs.reset(this.name + ".lastSync");
    Svc.Prefs.set(this.name + ".lastSync", "0");
  },

  // Create a new record by querying the store, and add the engine metadata
  _createRecord: function SyncEngine__createRecord(id) {
    return this._store.createRecord(id, this.cryptoMetaURL);
  },

  // Check if a record is "like" another one, even though the IDs are different,
  // in that case, we'll change the ID of the local item to match
  // Probably needs to be overridden in a subclass, to change which criteria
  // make two records "the same one"
  _recordLike: function SyncEngine__recordLike(a, b) {
    if (a.parentid != b.parentid)
      return false;
    if (a.depth != b.depth)
      return false;
    // note: sortindex ignored
    if (a.deleted || b.deleted)
      return false;
    return Utils.deepEquals(a.cleartext, b.cleartext);
  },

  _lowMemCheck: function SyncEngine__lowMemCheck() {
    if (Svc.Memory.isLowMemory()) {
      this._log.warn("Low memory, forcing GC");
      Cu.forceGC();
      if (Svc.Memory.isLowMemory()) {
        this._log.warn("Low memory, aborting sync!");
        throw "Low memory";
      }
    }
  },

  // Any setup that needs to happen at the beginning of each sync.
  // Makes sure crypto records and keys are all set-up
  _syncStartup: function SyncEngine__syncStartup() {
    this._log.debug("Ensuring server crypto records are there");

    let meta = CryptoMetas.get(this.cryptoMetaURL);
    if (!meta) {
      let symkey = Svc.Crypto.generateRandomKey();
      let pubkey = PubKeys.getDefaultKey();
      meta = new CryptoMeta(this.cryptoMetaURL);
      meta.generateIV();
      meta.addUnwrappedKey(pubkey, symkey);
      let res = new Resource(meta.uri);
      res.put(meta.serialize());
    }

    // first sync special case: upload all items
    // NOTE: we use a backdoor (of sorts) to the tracker so it
    // won't save to disk this list over and over
    if (!this.lastSync) {
      this._log.info("First sync, uploading all items");
      this._tracker.clearChangedIDs();
      [i for (i in this._store.getAllIDs())]
        .forEach(function(id) this._tracker.changedIDs[id] = true, this);
    }

    let outnum = [i for (i in this._tracker.changedIDs)].length;
    this._log.info(outnum + " outgoing items pre-reconciliation");
  },

  // Generate outgoing records
  _processIncoming: function SyncEngine__processIncoming() {
    this._log.debug("Downloading & applying server changes");

    // enable cache, and keep only the first few items.  Otherwise (when
    // we have more outgoing items than can fit in the cache), we will
    // keep rotating items in and out, perpetually getting cache misses
    this._store.cache.enabled = true;
    this._store.cache.fifo = false; // filo
    this._store.cache.clear();

    let newitems = new Collection(this.engineURL, this._recordObj);
    newitems.newer = this.lastSync;
    newitems.full = true;
    newitems.sort = "depthindex";
    newitems.get();

    let item;
    let count = {applied: 0, reconciled: 0};
    this._lastSyncTmp = 0;

    while ((item = newitems.iter.next())) {
      this._lowMemCheck();
      try {
        item.decrypt(ID.get('WeaveCryptoID').password);
        if (this._reconcile(item)) {
          count.applied++;
          this._applyIncoming(item);
        } else {
          count.reconciled++;
          this._log.trace("Skipping reconciled incoming item " + item.id);
          if (this._lastSyncTmp < item.modified)
            this._lastSyncTmp = item.modified;
        }
      } catch (e) {
	this._log.error("Could not process incoming record: " +
			Utils.exceptionStr(e));
      }
      Sync.sleep(0);
    }
    if (this.lastSync < this._lastSyncTmp)
        this.lastSync = this._lastSyncTmp;

    this._log.info("Applied " + count.applied + " records, reconciled " +
                    count.reconciled + " records");

    // try to free some memory
    this._store.cache.clear();
    Cu.forceGC();
  },

  _isEqual: function SyncEngine__isEqual(item) {
    let local = this._createRecord(item.id);
    this._log.trace("Local record: \n" + local);
    if (item.parentid == local.parentid &&
        item.sortindex == local.sortindex &&
        item.deleted == local.deleted &&
        Utils.deepEquals(item.cleartext, local.cleartext)) {
      this._log.trace("Local record is the same");
      return true;
    } else {
      this._log.trace("Local record is different");
      return false;
    }
  },

  // Reconciliation has three steps:
  // 1) Check for the same item (same ID) on both the incoming and outgoing
  //    queues.  This means the same item was modified on this profile and
  //    another at the same time.  In this case, this client wins (which really
  //    means, the last profile you sync wins).
  // 2) Check if the incoming item's ID exists locally.  In that case it's an
  //    update and we should not try a similarity check (step 3)
  // 3) Check if any incoming & outgoing items are actually the same, even
  //    though they have different IDs.  This happens when the same item is
  //    added on two different machines at the same time.  It's also the common
  //    case when syncing for the first time two machines that already have the
  //    same bookmarks.  In this case we change the IDs to match.
  _reconcile: function SyncEngine__reconcile(item) {
    // Step 1: Check for conflicts
    //         If same as local record, do not upload
    this._log.trace("Reconcile step 1");
    if (item.id in this._tracker.changedIDs) {
      if (this._isEqual(item))
        this._tracker.removeChangedID(item.id);
      return false;
    }

    // Step 2: Check for updates
    //         If different from local record, apply server update
    this._log.trace("Reconcile step 2");
    if (this._store.itemExists(item.id))
      return !this._isEqual(item);

    // If the incoming item has been deleted, skip step 3
    this._log.trace("Reconcile step 2.5");
    if (item.deleted)
      return true;

    // Step 3: Check for similar items
    this._log.trace("Reconcile step 3");
    for (let id in this._tracker.changedIDs) {
      let out = this._createRecord(id);
      if (this._recordLike(item, out)) {
        this._store.changeItemID(id, item.id);
        this._tracker.removeChangedID(id);
        this._tracker.removeChangedID(item.id);
        this._store.cache.clear(); // because parentid refs will be wrong
        return false;
      }
    }

    return true;
  },

  // Apply incoming records
  _applyIncoming: function SyncEngine__applyIncoming(item) {
    this._log.trace("Incoming:\n" + item);
    try {
      this._tracker.ignoreAll = true;
      this._store.applyIncoming(item);
      if (this._lastSyncTmp < item.modified)
        this._lastSyncTmp = item.modified;
    } catch (e) {
      this._log.warn("Error while applying incoming record: " +
                     (e.message? e.message : e));
    } finally {
      this._tracker.ignoreAll = false;
    }
  },

  // Upload outgoing records
  _uploadOutgoing: function SyncEngine__uploadOutgoing() {
    let outnum = [i for (i in this._tracker.changedIDs)].length;
    this._log.debug("Preparing " + outnum + " outgoing records");
    if (outnum) {
      // collection we'll upload
      let up = new Collection(this.engineURL);
      let meta = {};

      // don't cache the outgoing items, we won't need them later
      this._store.cache.enabled = false;

      for (let id in this._tracker.changedIDs) {
        let out = this._createRecord(id);
        this._log.trace("Outgoing:\n" + out);
        // skip getting siblings of already processed and deleted records
        if (!out.deleted && !(out.id in meta))
          this._store.createMetaRecords(out.id, meta);
        out.encrypt(ID.get('WeaveCryptoID').password);
        up.pushData(JSON.parse(out.serialize())); // FIXME: inefficient
        Sync.sleep(0);
      }

      this._store.cache.enabled = true;

      // now add short depth-and-index-only records, except the ones we're
      // sending as full records
      let count = 0;
      for each (let obj in meta) {
          if (!(obj.id in this._tracker.changedIDs)) {
            up.pushData(obj);
            count++;
          }
      }

      this._log.info("Uploading " + outnum + " records + " + count + " index/depth records)");
      // do the upload
      up.post();

      // save last modified date
      let mod = up.data.modified;
      if (mod > this.lastSync)
        this.lastSync = mod;
    }
    this._tracker.clearChangedIDs();
  },

  // Any cleanup necessary.
  // Save the current snapshot so as to calculate changes at next sync
  _syncFinish: function SyncEngine__syncFinish() {
    this._log.debug("Finishing up sync");
    this._tracker.resetScore();
  },

  _sync: function SyncEngine__sync() {
    try {
      this._syncStartup();
      Observers.notify("weave:engine:sync:status", "process-incoming");
      this._processIncoming();
      Observers.notify("weave:engine:sync:status", "upload-outgoing");
      this._uploadOutgoing();
      this._syncFinish();
    }
    catch (e) {
      this._log.warn("Sync failed");
      throw e;
    }
  },

  _wipeServer: function SyncEngine__wipeServer() {
    new Resource(this.engineURL).delete();
    new Resource(this.cryptoMetaURL).delete();
  },

  _resetClient: function SyncEngine__resetClient() {
    this.resetLastSync();
  }
};
