function test_seek3(v, seekTime, is, ok, finish) {

// Test seeking works if current time is set but video is not played.
var startPassed = false;
var completed = false;
var gotTimeupdate = false;

function startTest() {
  if (completed)
    return false;

  v.currentTime=seekTime;
  return false;
}

function timeupdate() {
  gotTimeupdate = true;
  v.removeEventListener("timeupdate", timeupdate, false);
}

function seekStarted() {
  if (completed)
    return false;

  ok(v.currentTime >= seekTime - 0.1, "Video currentTime should be around " + seekTime + ": " + v.currentTime);
  v.addEventListener("timeupdate", timeupdate, false);
  startPassed = true;
  return false;
}

function seekEnded() {
  if (completed)
    return false;

  var t = v.currentTime;
  ok(Math.abs(t - seekTime) <= 0.1, "Video currentTime should be around " + seekTime + ": " + t);
  ok(gotTimeupdate, "Should have got timeupdate between seeking and seekended");
  completed = true;
  finish();
  return false;
}

v.addEventListener("loadedmetadata", startTest, false);
v.addEventListener("seeking", seekStarted, false);
v.addEventListener("seeked", seekEnded, false);

}
