/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

/**
 * Test exceptions inside black boxed sources.
 */

var gDebuggee;
var gClient;
var gThreadClient;

function run_test()
{
  initTestDebuggerServer();
  gDebuggee = addTestGlobal("test-black-box");
  gClient = new DebuggerClient(DebuggerServer.connectPipe());
  gClient.connect(function() {
    attachTestTabAndResume(gClient, "test-black-box", function(aResponse, aTabClient, aThreadClient) {
      gThreadClient = aThreadClient;
      // XXX: We have to do an executeSoon so that the error isn't caught and
      // reported by DebuggerClient.requester (because we are using the local
      // transport and share a stack) which causes the test to fail.
      Services.tm.mainThread.dispatch({
        run: test_black_box
      }, Ci.nsIThread.DISPATCH_NORMAL);
    });
  });
  do_test_pending();
}

const BLACK_BOXED_URL = "http://example.com/blackboxme.js";
const SOURCE_URL = "http://example.com/source.js";

function test_black_box()
{
  gClient.addOneTimeListener("paused", test_black_box_exception);

  Components.utils.evalInSandbox(
    "" + function doStuff(k) {                                   // line 1
      throw new Error("wu tang clan ain't nuthin' ta fuck wit"); // line 2
      k(100);                                                    // line 3
    },                                                           // line 4
    gDebuggee,
    "1.8",
    BLACK_BOXED_URL,
    1
  );

  Components.utils.evalInSandbox(
    "" + function runTest() { // line 1
      doStuff(                // line 2
        function (n) {        // line 3
          debugger;           // line 4
        }                     // line 5
      );                      // line 6
    }                         // line 7
    + "\ndebugger;\n"         // line 8
    + "runTest()",            // line 9
    gDebuggee,
    "1.8",
    SOURCE_URL,
    1
  );
}

function test_black_box_exception() {
  gThreadClient.getSources(function ({error, sources}) {
    do_check_true(!error, "Should not get an error: " + error);
    let sourceClient = gThreadClient.source(sources.filter(s => s.url == BLACK_BOXED_URL)[0]);

    sourceClient.blackBox(function ({error}) {
      do_check_true(!error, "Should not get an error: " + error);
      gThreadClient.pauseOnExceptions(true);

      gClient.addOneTimeListener("paused", function (aEvent, aPacket) {
        do_check_neq(aPacket.frame.where.url, BLACK_BOXED_URL,
                     "We shouldn't pause while in the black boxed source.");
        finishClient(gClient);
      });

      gThreadClient.resume();
    });
  });
}
