/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

module.metadata = {
  "stability": "experimental"
};


const { Cc, Ci, Cr } = require("chrome");
const { Class } = require("./heritage");
const { isWeak } = require("./reference");
const method = require("../../method/core");

const { addObserver, removeObserver } = Cc['@mozilla.org/observer-service;1'].
                                          getService(Ci.nsIObserverService);


// This is a method that will be invoked when notification observer
// subscribed to occurs.
const observe = method("observer/observe");
exports.observe = observe;

// Method to subscribe to the observer notification.
const subscribe = method("observe/subscribe");
exports.subscribe = subscribe;


// Method to unsubscribe from the observer notifications.
const unsubscribe = method("observer/unsubscribe");
exports.unsubscribe = unsubscribe;


// This is wrapper class that takes a `delegate` and produces
// instance of `nsIObserver` which will delegate to a given
// object when observer notification occurs.
const ObserverDelegee = Class({
  initialize: function(delegate) {
    this.delegate = delegate;
  },
  QueryInterface: function(iid) {
    const isObserver = iid.equals(Ci.nsIObserver);
    const isWeakReference = iid.equals(Ci.nsISupportsWeakReference);

    if (!isObserver && !isWeakReference)
      throw Cr.NS_ERROR_NO_INTERFACE;

    return this;
  },
  observe: function(subject, topic, data) {
    observe(this.delegate, subject, topic, data);
  }
});


// Class that can be either mixed in or inherited from in
// order to subscribe / unsubscribe for observer notifications.
const Observer = Class({});
exports.Observer = Observer;

// Weak maps that associates instance of `ObserverDelegee` with
// an actual observer. It ensures that `ObserverDelegee` instance
// won't be GC-ed until given `observer` is.
const subscribers = new WeakMap();

// Implementation of `subscribe` for `Observer` type just registers
// observer for an observer service. If `isWeak(observer)` is `true`
// observer service won't hold strong reference to a given `observer`.
subscribe.define(Observer, (observer, topic) => {
  if (!subscribers.has(observer)) {
    const delegee = new ObserverDelegee(observer);
    subscribers.set(observer, delegee);
    addObserver(delegee, topic, isWeak(observer));
  }
});

// Unsubscribes `observer` from observer notifications for the
// given `topic`.
unsubscribe.define(Observer, (observer, topic) => {
  const delegee = subscribers.get(observer);
  if (delegee) {
    subscribers.delete(observer);
    removeObserver(delegee, topic);
  }
});
