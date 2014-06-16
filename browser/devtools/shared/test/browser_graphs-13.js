/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

// Tests that graph widgets may have a fixed width or height.

let {LineGraphWidget} = Cu.import("resource:///modules/devtools/Graphs.jsm", {});
let {DOMHelpers} = Cu.import("resource:///modules/devtools/DOMHelpers.jsm", {});
let {Promise} = devtools.require("resource://gre/modules/Promise.jsm");
let {Hosts} = devtools.require("devtools/framework/toolbox-hosts");

let test = Task.async(function*() {
  yield promiseTab("about:blank");
  yield performTest();
  gBrowser.removeCurrentTab();
  finish();
});

function* performTest() {
  let [host, win, doc] = yield createHost();
  doc.body.setAttribute("style", "position: fixed; width: 100%; height: 100%; margin: 0;");

  let graph = new LineGraphWidget(doc.body, "fps");
  graph.fixedWidth = 200;
  graph.fixedHeight = 100;

  yield graph.ready();
  testGraph(host, graph);

  graph.destroy();
  host.destroy();
}

function testGraph(host, graph) {
  let bounds = host.frame.getBoundingClientRect();

  isnot(graph.width, bounds.width * window.devicePixelRatio,
    "The graph should not span all the parent node's width.");
  isnot(graph.height, bounds.height * window.devicePixelRatio,
    "The graph should not span all the parent node's height.");

  is(graph.width, graph.fixedWidth * window.devicePixelRatio,
    "The graph has the correct width.");
  is(graph.height, graph.fixedHeight * window.devicePixelRatio,
    "The graph has the correct height.");
}
